import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { ChatRequestDto, ChatResponseDto, MessageDto, ConversationDto, ConversationDetailDto } from '@soc/shared';

const CHUTES_BASE_URL = process.env.CHUTES_BASE_URL || 'https://llm.chutes.ai/v1';
const CHUTES_MODEL = process.env.CHUTES_MODEL || 'Qwen/Qwen2.5-72B-Instruct';
const CHUTES_API_KEY = process.env.CHUTES_API_KEY || '';

const LOG_SCHEMA = `
Table: logs
Columns:
  id             String (cuid)
  workspaceId    String
  timestamp      Int (Unix epoch seconds)
  severity       String (unknown | low | medium | high | critical)
  vendor         String (e.g. "paloalto")
  eventType      String (e.g. "traffic", "threat", "system")
  action         String? (e.g. "allow", "deny", "drop")
  application    String? (e.g. "soap", "ssl", "web-browsing")
  protocol       String? (e.g. "tcp", "udp")
  policy         String? (e.g. "Allow Tap Traffic")
  sourceIp       String?
  sourcePort     Int?
  destinationIp  String?
  destinationPort Int?
  rawLog         String (full raw syslog text)
  createdAt      DateTime

Table: workspaces
Columns:
  id          String (cuid)
  companyId   String
  name        String

Relation: logs.workspaceId -> workspaces.id
`;

interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Conversation CRUD ──────────────────────────────────────

  async listConversations(userId: string): Promise<ConversationDto[]> {
    const convos = await this.prisma.conversation.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });
    return convos.map((c) => ({
      id: c.id,
      title: c.title,
      companyId: c.companyId,
      workspaceId: c.workspaceId,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    }));
  }

  async getConversation(userId: string, conversationId: string): Promise<ConversationDetailDto> {
    const convo = await this.prisma.conversation.findFirst({
      where: { id: conversationId, userId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!convo) throw new HttpException('Conversation not found', HttpStatus.NOT_FOUND);

    return {
      id: convo.id,
      title: convo.title,
      companyId: convo.companyId,
      workspaceId: convo.workspaceId,
      createdAt: convo.createdAt.toISOString(),
      updatedAt: convo.updatedAt.toISOString(),
      messages: convo.messages.map((m) => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        logsUsed: m.logsUsed,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  }

  async deleteConversation(userId: string, conversationId: string): Promise<void> {
    const convo = await this.prisma.conversation.findFirst({
      where: { id: conversationId, userId },
    });
    if (!convo) throw new HttpException('Conversation not found', HttpStatus.NOT_FOUND);
    await this.prisma.conversation.delete({ where: { id: conversationId } });
  }

  // ── Send message (the main flow) ──────────────────────────

  async sendMessage(userId: string, dto: ChatRequestDto): Promise<ChatResponseDto> {
    const { message, conversationId, companyId, workspaceId } = dto;

    // get or create conversation
    let convo: any;
    if (conversationId) {
      convo = await this.prisma.conversation.findFirst({
        where: { id: conversationId, userId },
        include: { messages: { orderBy: { createdAt: 'asc' } } },
      });
      if (!convo) throw new HttpException('Conversation not found', HttpStatus.NOT_FOUND);
    } else {
      convo = await this.prisma.conversation.create({
        data: {
          userId,
          companyId: companyId || null,
          workspaceId: workspaceId || null,
        },
        include: { messages: true },
      });
    }

    // save user message
    const userMsg = await this.prisma.message.create({
      data: {
        conversationId: convo.id,
        role: 'user',
        content: message,
      },
    });

    // build history from DB
    const history: MessageDto[] = convo.messages.map((m: any) => ({
      id: m.id,
      role: m.role,
      content: m.content,
    }));

    const effectiveCompanyId = companyId || convo.companyId;
    const effectiveWorkspaceId = workspaceId || convo.workspaceId;

    // call 1: generate query
    const queryJson = await this.generateQuery(message, effectiveCompanyId, effectiveWorkspaceId, history);

    // execute query
    const logs = await this.executePrismaQuery(queryJson, effectiveCompanyId, effectiveWorkspaceId);

    // call 2: generate answer
    const reply = await this.generateAnswer(message, logs, history);

    // save assistant message
    const assistantMsg = await this.prisma.message.create({
      data: {
        conversationId: convo.id,
        role: 'assistant',
        content: reply,
        logsUsed: logs.length,
      },
    });

    // auto-title on first message
    if (convo.messages.length === 0) {
      this.generateTitle(message, convo.id).catch(() => {});
    }

    // bump updatedAt
    await this.prisma.conversation.update({
      where: { id: convo.id },
      data: { updatedAt: new Date() },
    });

    return {
      conversationId: convo.id,
      message: {
        id: assistantMsg.id,
        role: 'assistant',
        content: reply,
        logsUsed: logs.length,
        createdAt: assistantMsg.createdAt.toISOString(),
      },
      logsUsed: logs.length,
    };
  }

  // ── Title generation (fire and forget) ────────────────────

  private async generateTitle(firstMessage: string, conversationId: string) {
    try {
      const raw = await this.callLlm([
        {
          role: 'system',
          content: 'Generate a short title (max 6 words) for a SOC chat conversation based on the user\'s first message. Return ONLY the title text, nothing else. No quotes.',
        },
        { role: 'user', content: firstMessage },
      ]);
      const title = raw.trim().replace(/^["']|["']$/g, '').slice(0, 80);
      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: { title },
      });
    } catch (err) {
      this.logger.warn(`Failed to generate title: ${err}`);
    }
  }

  // ── LLM query generation ──────────────────────────────────

  private async generateQuery(
    message: string,
    companyId?: string | null,
    workspaceId?: string | null,
    history?: MessageDto[],
  ): Promise<any> {
    const contextParts: string[] = [];
    if (workspaceId) contextParts.push(`The user is viewing workspace ID: "${workspaceId}"`);
    else if (companyId) contextParts.push(`The user is viewing company ID: "${companyId}". Query logs across ALL workspaces belonging to this company.`);
    else contextParts.push('No specific workspace/company selected. Query across all logs.');

    const systemPrompt = `You are a database query assistant for a SOC (Security Operations Center) platform.
Given a user's question about security logs, generate a Prisma "where" clause (as JSON) and optional ordering/limit to retrieve the relevant logs.

${LOG_SCHEMA}

RULES:
- Return ONLY valid JSON. No markdown, no explanation, no code fences.
- The JSON must have this shape: { "where": {}, "orderBy": {}, "take": number }
- "where" is a Prisma where clause for the Log model.
- "orderBy" defaults to { "timestamp": "desc" } if not specified.
- "take" is optional. Omit it to retrieve ALL matching logs. Only set it if the user explicitly asks for a specific number (e.g. "show me the last 50").
- ${contextParts.join(' ')}
- ${workspaceId ? `Always include workspaceId: "${workspaceId}" in the where clause.` : ''}
- ${companyId && !workspaceId ? `To filter by company, use: workspace: { companyId: "${companyId}" }` : ''}
- For time-based queries, "timestamp" is Unix epoch (seconds). Current time is approximately ${Math.floor(Date.now() / 1000)}.
- Use Prisma operators: equals, not, in, notIn, lt, lte, gt, gte, contains (for string search), mode: "insensitive" for case-insensitive.
- For "latest" or "recent" queries without a specific count, just use orderBy desc without a take limit.
- For severity filtering, valid values are: unknown, low, medium, high, critical (lowercase).
- For string matching on fields like eventType, vendor, action, application — use contains with mode: "insensitive" so casing doesn't matter.`;

    const messages: LlmMessage[] = [
      { role: 'system', content: systemPrompt },
    ];

    if (history?.length) {
      for (const msg of history.slice(-6)) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    messages.push({ role: 'user', content: message });

    const raw = await this.callLlm(messages);

    try {
      const cleaned = raw.replace(/```(?:json)?\s*/g, '').replace(/```/g, '').trim();
      return JSON.parse(cleaned);
    } catch {
      this.logger.warn(`LLM returned unparseable query, falling back to default. Raw: ${raw}`);
      const fallback: any = { where: {}, orderBy: { timestamp: 'desc' } };
      if (workspaceId) fallback.where.workspaceId = workspaceId;
      if (companyId && !workspaceId) fallback.where.workspace = { companyId };
      return fallback;
    }
  }

  // ── Query execution ───────────────────────────────────────

  private async executePrismaQuery(queryJson: any, companyId?: string | null, workspaceId?: string | null) {
    const { where = {}, orderBy = { timestamp: 'desc' }, take } = queryJson;

    if (workspaceId) {
      where.workspaceId = workspaceId;
    } else if (companyId) {
      where.workspace = { ...where.workspace, companyId };
    }

    const queryOptions: any = { where, orderBy };
    if (take !== undefined && take !== null) {
      queryOptions.take = Math.max(take, 1);
    }

    try {
      return await this.prisma.log.findMany(queryOptions);
    } catch (err) {
      this.logger.error(`Prisma query failed: ${err}. Query: ${JSON.stringify(queryJson)}`);
      const fallbackWhere: any = {};
      if (workspaceId) fallbackWhere.workspaceId = workspaceId;
      else if (companyId) fallbackWhere.workspace = { companyId };

      return this.prisma.log.findMany({
        where: fallbackWhere,
        orderBy: { timestamp: 'desc' },
        take: 200,
      });
    }
  }

  // ── Log context builder ───────────────────────────────────

  private buildLogContext(logs: any[]): string {
    const total = logs.length;
    if (total === 0) return 'No logs matched the query.';

    const bySeverity: Record<string, number> = {};
    const byEventType: Record<string, number> = {};
    const byAction: Record<string, number> = {};
    const byVendor: Record<string, number> = {};
    const byProtocol: Record<string, number> = {};
    const srcIpCounts: Record<string, number> = {};
    const dstIpCounts: Record<string, number> = {};
    let minTs = Infinity;
    let maxTs = -Infinity;

    for (const l of logs) {
      bySeverity[l.severity] = (bySeverity[l.severity] || 0) + 1;
      byEventType[l.eventType] = (byEventType[l.eventType] || 0) + 1;
      if (l.action) byAction[l.action] = (byAction[l.action] || 0) + 1;
      byVendor[l.vendor] = (byVendor[l.vendor] || 0) + 1;
      if (l.protocol) byProtocol[l.protocol] = (byProtocol[l.protocol] || 0) + 1;
      if (l.sourceIp) srcIpCounts[l.sourceIp] = (srcIpCounts[l.sourceIp] || 0) + 1;
      if (l.destinationIp) dstIpCounts[l.destinationIp] = (dstIpCounts[l.destinationIp] || 0) + 1;
      if (l.timestamp < minTs) minTs = l.timestamp;
      if (l.timestamp > maxTs) maxTs = l.timestamp;
    }

    const topN = (map: Record<string, number>, n: number) =>
      Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, n)
        .map(([k, v]) => `${k}: ${v}`).join(', ');

    const parts = [
      `Total logs retrieved: ${total}`,
      `Time range: ${new Date(minTs * 1000).toISOString()} to ${new Date(maxTs * 1000).toISOString()}`,
      `Severity breakdown: ${topN(bySeverity, 10)}`,
      `Event types: ${topN(byEventType, 10)}`,
      `Actions: ${topN(byAction, 10)}`,
      `Vendors: ${topN(byVendor, 10)}`,
      Object.keys(byProtocol).length > 0 ? `Protocols: ${topN(byProtocol, 10)}` : null,
      `Top source IPs: ${topN(srcIpCounts, 15)}`,
      `Top destination IPs: ${topN(dstIpCounts, 15)}`,
    ].filter(Boolean);

    const sampleLogs = total <= 50
      ? logs
      : [...logs.slice(0, 30), ...logs.slice(-10)];

    const sample = sampleLogs.map((l) => ({
      time: new Date(l.timestamp * 1000).toISOString(),
      severity: l.severity,
      vendor: l.vendor,
      event: l.eventType,
      action: l.action,
      app: l.application,
      proto: l.protocol,
      src: l.sourceIp ? `${l.sourceIp}:${l.sourcePort || ''}` : null,
      dst: l.destinationIp ? `${l.destinationIp}:${l.destinationPort || ''}` : null,
      policy: l.policy,
    }));

    parts.push(`\nSample logs (${sampleLogs.length} of ${total}):\n${JSON.stringify(sample, null, 1)}`);

    return parts.join('\n');
  }

  // ── Answer generation ─────────────────────────────────────

  private async generateAnswer(message: string, logs: any[], history?: MessageDto[]): Promise<string> {
    const logContext = this.buildLogContext(logs);

    const systemPrompt = `You are Lurka, a SOC (Security Operations Center) AI analyst assistant.
You help security analysts investigate logs, identify threats, and understand network activity.

RULES:
- Be concise and professional. No fluff.
- Reference specific data from the logs (IPs, timestamps, counts, patterns).
- If the logs show something suspicious, highlight it clearly.
- If the logs look normal, say so. Don't invent threats.
- Use plain text. No markdown headers. Keep paragraphs short.
- When mentioning counts, be precise based on the data provided.
- You have aggregated stats and a sample of the ${logs.length} logs retrieved. Use both to answer.
${logs.length === 0 ? '- No logs matched the query. Let the user know and suggest refining their question.' : ''}`;

    const messages: LlmMessage[] = [
      { role: 'system', content: systemPrompt },
    ];

    if (history?.length) {
      for (const msg of history.slice(-6)) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    const userContent = logs.length > 0
      ? `${message}\n\n--- LOG DATA ---\n${logContext}`
      : message;

    messages.push({ role: 'user', content: userContent });

    return this.callLlm(messages);
  }

  // ── LLM caller ────────────────────────────────────────────

  private async callLlm(messages: LlmMessage[]): Promise<string> {
    const res = await fetch(`${CHUTES_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CHUTES_API_KEY}`,
      },
      body: JSON.stringify({
        model: CHUTES_MODEL,
        messages,
        temperature: 0.2,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`LLM API error ${res.status}: ${text}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || 'No response from model.';
  }
}
