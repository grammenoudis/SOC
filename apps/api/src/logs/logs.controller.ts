import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthGuard } from '../common/guards/auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';

@Controller('logs')
@UseGuards(AuthGuard)
export class LogsController {
  constructor(private readonly prisma: PrismaService) {}

  // POST /logs/ingest — bulk or single log ingestion
  @Post('ingest')
  async ingest(@Body() body: any | any[]) {
    const logs = Array.isArray(body) ? body : [body];

    if (logs.length === 0) {
      throw new HttpException('No logs provided', HttpStatus.BAD_REQUEST);
    }

    // Validate all workspaceIds exist
    const workspaceIds = [...new Set(logs.map((l) => l.workspaceId))];
    const workspaces = await this.prisma.workspace.findMany({
      where: { id: { in: workspaceIds } },
      select: { id: true },
    });
    const validIds = new Set(workspaces.map((w) => w.id));

    const invalid = workspaceIds.filter((id) => !validIds.has(id));
    if (invalid.length > 0) {
      throw new HttpException(`Invalid workspace IDs: ${invalid.join(', ')}`, HttpStatus.BAD_REQUEST);
    }

    const data = logs.map((l) => ({
      workspaceId: l.workspaceId,
      timestamp: l.timestamp,
      severity: l.severity || 'unknown',
      vendor: l.vendor,
      eventType: l.eventType,
      action: l.action || null,
      application: l.application || null,
      protocol: l.protocol || null,
      policy: l.policy || null,
      sourceIp: l.sourceIp || l.source?.ip || null,
      sourcePort: l.sourcePort ?? l.source?.port ?? null,
      destinationIp: l.destinationIp || l.destination?.ip || null,
      destinationPort: l.destinationPort ?? l.destination?.port ?? null,
      rawLog: l.rawLog,
    }));

    const result = await this.prisma.log.createMany({ data });

    return { data: { count: result.count } };
  }

  // GET /logs/workspace/:workspaceId — query logs with filters
  @Get('workspace/:workspaceId')
  async getByWorkspace(
    @Param('workspaceId') workspaceId: string,
    @Query('severity') severity?: string,
    @Query('vendor') vendor?: string,
    @Query('eventType') eventType?: string,
    @Query('action') action?: string,
    @Query('sourceIp') sourceIp?: string,
    @Query('destinationIp') destinationIp?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const workspace = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) {
      throw new HttpException('Workspace not found', HttpStatus.NOT_FOUND);
    }

    const where: any = { workspaceId };

    if (severity) where.severity = severity;
    if (vendor) where.vendor = vendor;
    if (eventType) where.eventType = eventType;
    if (action) where.action = action;
    if (sourceIp) where.sourceIp = sourceIp;
    if (destinationIp) where.destinationIp = destinationIp;

    // Time range filter (unix epoch)
    if (from || to) {
      where.timestamp = {};
      if (from) where.timestamp.gte = parseInt(from, 10);
      if (to) where.timestamp.lte = parseInt(to, 10);
    }

    // Full-text search on rawLog
    if (search) {
      where.rawLog = { contains: search, mode: 'insensitive' };
    }

    const take = Math.min(parseInt(limit || '50', 10), 200);
    const skip = (Math.max(parseInt(page || '1', 10), 1) - 1) * take;

    const [logs, total] = await Promise.all([
      this.prisma.log.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        take,
        skip,
      }),
      this.prisma.log.count({ where }),
    ]);

    return {
      data: logs,
      meta: {
        total,
        page: Math.floor(skip / take) + 1,
        limit: take,
        pages: Math.ceil(total / take),
      },
    };
  }

  // GET /logs/:id — single log detail
  @Get(':id')
  async getById(@Param('id') id: string) {
    const log = await this.prisma.log.findUnique({
      where: { id },
      include: { workspace: { select: { id: true, name: true, companyId: true } } },
    });

    if (!log) {
      throw new HttpException('Log not found', HttpStatus.NOT_FOUND);
    }

    return { data: log };
  }

  // PATCH /logs/:id — update a log entry (admin only)
  @Patch(':id')
  @UseGuards(AdminGuard)
  async update(
    @Param('id') id: string,
    @Body() body: {
      severity?: string;
      vendor?: string;
      eventType?: string;
      action?: string;
      application?: string;
      protocol?: string;
      policy?: string;
    },
  ) {
    const existing = await this.prisma.log.findUnique({ where: { id } });
    if (!existing) {
      throw new HttpException('Log not found', HttpStatus.NOT_FOUND);
    }

    const data: Record<string, any> = {};
    if (body.severity !== undefined) data.severity = body.severity;
    if (body.vendor !== undefined) data.vendor = body.vendor;
    if (body.eventType !== undefined) data.eventType = body.eventType;
    if (body.action !== undefined) data.action = body.action;
    if (body.application !== undefined) data.application = body.application;
    if (body.protocol !== undefined) data.protocol = body.protocol;
    if (body.policy !== undefined) data.policy = body.policy;

    if (Object.keys(data).length === 0) {
      throw new HttpException('No fields to update', HttpStatus.BAD_REQUEST);
    }

    const log = await this.prisma.log.update({ where: { id }, data });
    return { data: log };
  }

  // DELETE /logs/:id — delete a single log (admin only)
  @Delete(':id')
  @UseGuards(AdminGuard)
  async delete(@Param('id') id: string) {
    const existing = await this.prisma.log.findUnique({ where: { id } });
    if (!existing) {
      throw new HttpException('Log not found', HttpStatus.NOT_FOUND);
    }

    await this.prisma.log.delete({ where: { id } });
    return { data: { id } };
  }

  // DELETE /logs/workspace/:workspaceId — clear all logs for a workspace (admin only)
  @Delete('workspace/:workspaceId')
  @UseGuards(AdminGuard)
  async deleteByWorkspace(@Param('workspaceId') workspaceId: string) {
    const workspace = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) {
      throw new HttpException('Workspace not found', HttpStatus.NOT_FOUND);
    }

    const result = await this.prisma.log.deleteMany({ where: { workspaceId } });
    return { data: { deleted: result.count } };
  }
}
