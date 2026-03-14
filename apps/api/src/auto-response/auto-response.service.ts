import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../events/events.gateway';

interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const getOpenAiConfig = () => ({
  baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  model: process.env.OPENAI_MODEL || 'gpt-5.1',
  apiKey: process.env.OPENAI_API_KEY || '',
});

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-5.1': { input: 2.00, output: 8.00 },
  'gpt-4.1': { input: 2.00, output: 8.00 },
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
};

function calcCostUsd(model: string, prompt: number, completion: number): number {
  const p = MODEL_PRICING[model] || MODEL_PRICING['gpt-5.1'];
  return (prompt * p.input + completion * p.output) / 1_000_000;
}

@Injectable()
export class AutoResponseService {
  private readonly logger = new Logger(AutoResponseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsGateway,
  ) {}

  // Called fire-and-forget from AnalysisService after alert creation
  async generate(alertId: string, workspaceId: string): Promise<void> {
    try {
      await this._generate(alertId, workspaceId);
    } catch (err) {
      this.logger.error(`Auto-response generation failed for alert ${alertId}: ${err}`);
    }
  }

  private async _generate(alertId: string, workspaceId: string): Promise<void> {
    const { apiKey } = getOpenAiConfig();
    if (!apiKey) return;

    const [alert, workspace] = await Promise.all([
      this.prisma.alert.findUnique({
        where: { id: alertId },
        select: { id: true, title: true, description: true, severity: true, sourceIp: true, destinationIp: true },
      }),
      this.prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: {
          id: true,
          companyId: true,
          autoResponseEnabled: true,
          deviceHost: true,
          devicePort: true,
          deviceUser: true,
          devicePassword: true,
        },
      }),
    ]);

    if (!alert || !workspace) return;

    // get dominant vendor from recent logs in this workspace
    const recentLogs = await this.prisma.log.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { vendor: true },
    });

    const vendorCounts: Record<string, number> = {};
    for (const l of recentLogs) {
      vendorCounts[l.vendor] = (vendorCounts[l.vendor] || 0) + 1;
    }
    const vendor = Object.entries(vendorCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'generic';

    const systemPrompt = `You are an automated SOC incident response system. Based on an alert, you generate specific CLI commands to run on the affected network device to contain or mitigate the threat.

You must respond with a JSON object in this exact format:
{
  "reasoning": "Brief explanation of your response strategy",
  "commands": [
    {
      "type": "block_ip | rate_limit | disable_user | isolate_host | custom",
      "target": "the IP, username, or host this command acts on",
      "command": "the exact CLI command(s) to run, multi-line if needed",
      "reasoning": "why this specific command"
    }
  ]
}

VENDOR: ${vendor}
Generate commands using the correct CLI syntax for this vendor. For FortiGate use FortiOS CLI. For PaloAlto use PAN-OS CLI. For Cisco use IOS/ASA CLI. For generic/unknown use iptables/ipset Linux commands.

Rules:
- Only generate commands that are safe and reversible where possible
- Order commands by priority (most critical first)
- If the vendor is unknown, default to Linux iptables commands
- Keep commands concise and precise — these will be executed directly via SSH
- Return ONLY valid JSON, no markdown`;

    const userMsg = `Alert: ${alert.title}
Severity: ${alert.severity}
Description: ${alert.description}
Source IP: ${alert.sourceIp || 'unknown'}
Destination IP: ${alert.destinationIp || 'unknown'}`;

    const messages: LlmMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMsg },
    ];

    const { baseUrl, model } = getOpenAiConfig();
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages, temperature: 0.1, response_format: { type: 'json_object' } }),
    });

    if (!res.ok) {
      throw new Error(`LLM API error ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();
    const usage = data.usage || {};
    const content = data.choices?.[0]?.message?.content || '{}';

    // record usage
    const costUsd = calcCostUsd(model, usage.prompt_tokens || 0, usage.completion_tokens || 0);
    await this.prisma.llmUsage.create({
      data: {
        companyId: workspace.companyId,
        workspaceId,
        model,
        purpose: 'auto_response',
        promptTokens: usage.prompt_tokens || 0,
        completionTokens: usage.completion_tokens || 0,
        totalTokens: usage.total_tokens || 0,
        costUsd,
      },
    }).catch((err) => this.logger.warn(`Failed to record usage: ${err}`));

    let parsed: { reasoning: string; commands: Array<{ type: string; target: string; command: string; reasoning: string }> };
    try {
      let cleaned = content.replace(/```(?:json)?\s*/g, '').replace(/```/g, '').trim();
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) cleaned = match[0];
      parsed = JSON.parse(cleaned);
    } catch {
      this.logger.warn(`Auto-response LLM returned unparseable JSON for alert ${alertId}`);
      return;
    }

    if (!parsed.commands?.length) return;

    // auto-execute if enabled and device is configured, else recommended
    const canExecute = workspace.autoResponseEnabled && !!workspace.deviceHost && !!workspace.deviceUser;
    const responseStatus = canExecute ? 'pending' : 'recommended';

    const autoResponse = await this.prisma.autoResponse.create({
      data: {
        alertId,
        workspaceId,
        vendor,
        reasoning: parsed.reasoning || '',
        status: responseStatus,
        commands: {
          create: parsed.commands.map((cmd, idx) => ({
            type: cmd.type || 'custom',
            target: cmd.target || '',
            command: cmd.command || '',
            reasoning: cmd.reasoning || '',
            priority: idx,
            status: canExecute ? 'pending' : 'skipped',
          })),
        },
      },
    });

    this.events.emitAutoResponseUpdated(workspaceId, alertId);
    this.logger.log(`Auto-response created for alert ${alertId} (${responseStatus}, vendor: ${vendor})`);

    // if no device configured but autoResponseEnabled, warn
    if (workspace.autoResponseEnabled && !workspace.deviceHost) {
      this.logger.warn(`Workspace ${workspaceId} has autoResponseEnabled but no device configured`);
    }
  }

  // Logger polls this endpoint to pick up pending commands
  async getPending(workspaceId: string) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { deviceHost: true, devicePort: true, deviceUser: true, devicePassword: true, autoResponseEnabled: true },
    });

    if (!workspace?.autoResponseEnabled || !workspace.deviceHost) return { commands: [], device: null };

    const commands = await this.prisma.autoResponseCommand.findMany({
      where: {
        status: 'pending',
        autoResponse: { workspaceId, status: { in: ['pending', 'executing'] } },
      },
      orderBy: { priority: 'asc' },
      include: { autoResponse: { select: { id: true, alertId: true } } },
    });

    return {
      device: {
        host: workspace.deviceHost,
        port: workspace.devicePort || 22,
        user: workspace.deviceUser,
        password: workspace.devicePassword,
      },
      commands: commands.map((c) => ({
        id: c.id,
        autoResponseId: c.autoResponse.id,
        alertId: c.autoResponse.alertId,
        type: c.type,
        target: c.target,
        command: c.command,
        priority: c.priority,
      })),
    };
  }

  // Logger calls this after executing (or failing) a command
  async updateCommand(commandId: string, status: string, output: string | null, retryCount?: number) {
    const command = await this.prisma.autoResponseCommand.update({
      where: { id: commandId },
      data: {
        status,
        output,
        retryCount: retryCount !== undefined ? retryCount : { increment: status === 'failed' ? 1 : 0 },
        executedAt: status !== 'pending' ? new Date() : undefined,
      },
      include: {
        autoResponse: {
          select: { id: true, alertId: true, workspaceId: true, commands: { select: { status: true } } },
        },
      },
    });

    const ar = command.autoResponse;

    // if failed and hit max retries, notify all users
    if (status === 'failed' && command.retryCount >= 3) {
      await this.notifyAllUsers(ar.alertId, ar.workspaceId, command.type, command.target);
    }

    // update parent AutoResponse status based on all commands
    const allStatuses = ar.commands.map((c) => c.status);
    // re-fetch to get fresh statuses after our update
    const freshCommands = await this.prisma.autoResponseCommand.findMany({
      where: { autoResponseId: ar.id },
      select: { status: true },
    });
    const freshStatuses = freshCommands.map((c) => c.status);

    let newArStatus: string;
    if (freshStatuses.every((s) => s === 'success')) {
      newArStatus = 'completed';
    } else if (freshStatuses.some((s) => s === 'running' || s === 'pending')) {
      newArStatus = 'executing';
    } else if (freshStatuses.every((s) => s === 'failed' || s === 'skipped')) {
      newArStatus = 'failed';
    } else {
      newArStatus = 'executing';
    }

    await this.prisma.autoResponse.update({
      where: { id: ar.id },
      data: { status: newArStatus },
    });

    this.events.emitAutoResponseUpdated(ar.workspaceId, ar.alertId);

    return command;
  }

  async getByAlert(alertId: string) {
    return this.prisma.autoResponse.findUnique({
      where: { alertId },
      include: { commands: { orderBy: { priority: 'asc' } } },
    });
  }

  private async notifyAllUsers(alertId: string, workspaceId: string, commandType: string, target: string) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { name: true, company: { select: { name: true } } },
    });

    const users = await this.prisma.user.findMany({ select: { id: true } });

    const wsLabel = workspace ? `${workspace.company.name} / ${workspace.name}` : workspaceId;

    await this.prisma.notification.createMany({
      data: users.map((u) => ({
        userId: u.id,
        type: 'auto_response_failed',
        title: 'Auto-response failed',
        body: `Command "${commandType}" on target "${target}" failed after 3 attempts in ${wsLabel}.`,
        alertId,
      })),
    });

    // push WS notification to each user
    for (const user of users) {
      const notif = await this.prisma.notification.findFirst({
        where: { userId: user.id, alertId, type: 'auto_response_failed' },
        orderBy: { createdAt: 'desc' },
      });
      if (notif) {
        this.events.emitNotification({
          userId: user.id,
          notification: {
            id: notif.id,
            type: notif.type,
            title: notif.title,
            body: notif.body,
            alertId: notif.alertId,
            read: notif.read,
            createdAt: notif.createdAt.toISOString(),
          },
        });
      }
    }
  }
}
