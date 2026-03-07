import { Controller, Get, Post, Body, Param, Req, HttpException, HttpStatus } from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { auth } from '../auth/auth';

@Controller('companies/:companyId/workspaces')
export class WorkspacesController {
  constructor(private readonly prisma: PrismaService) {}

  private async requireUser(req: Request) {
    const session = await auth.api.getSession({ headers: req.headers as any });
    if (!session?.user) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }
    return session.user;
  }

  @Get()
  async list(@Req() req: Request, @Param('companyId') companyId: string) {
    await this.requireUser(req);

    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) {
      throw new HttpException('Company not found', HttpStatus.NOT_FOUND);
    }

    const workspaces = await this.prisma.workspace.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
    });

    return { data: workspaces };
  }

  @Get(':id')
  async getById(@Req() req: Request, @Param('companyId') companyId: string, @Param('id') id: string) {
    await this.requireUser(req);

    const workspace = await this.prisma.workspace.findFirst({
      where: { id, companyId },
      include: { company: { select: { id: true, name: true } } },
    });

    if (!workspace) {
      throw new HttpException('Workspace not found', HttpStatus.NOT_FOUND);
    }

    return { data: workspace };
  }

  @Post()
  async create(
    @Req() req: Request,
    @Param('companyId') companyId: string,
    @Body() body: { name: string; description?: string },
  ) {
    await this.requireUser(req);

    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) {
      throw new HttpException('Company not found', HttpStatus.NOT_FOUND);
    }

    const { name, description } = body;
    if (!name?.trim()) {
      throw new HttpException('Name is required', HttpStatus.BAD_REQUEST);
    }

    const workspace = await this.prisma.workspace.create({
      data: {
        companyId,
        name: name.trim(),
        description: description?.trim() || null,
      },
    });

    return { data: workspace };
  }
}
