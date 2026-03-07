import { Controller, Get, Post, Body, Param, Req, HttpException, HttpStatus } from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { auth } from '../auth/auth';

@Controller('companies')
export class CompaniesController {
  constructor(private readonly prisma: PrismaService) {}

  private async requireUser(req: Request) {
    const session = await auth.api.getSession({ headers: req.headers as any });
    if (!session?.user) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }
    return session.user;
  }

  @Get()
  async list(@Req() req: Request) {
    await this.requireUser(req);
    const companies = await this.prisma.company.findMany({
      include: {
        _count: { select: { workspaces: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const data = companies.map((c) => ({
      id: c.id,
      name: c.name,
      contact: c.contact,
      workspaces: c._count.workspaces,
      createdAt: c.createdAt,
    }));

    return { data };
  }

  @Get(':id')
  async getById(@Req() req: Request, @Param('id') id: string) {
    await this.requireUser(req);
    const company = await this.prisma.company.findUnique({
      where: { id },
      include: {
        workspaces: {
          orderBy: { createdAt: 'desc' },
        },
        _count: { select: { workspaces: true } },
      },
    });

    if (!company) {
      throw new HttpException('Company not found', HttpStatus.NOT_FOUND);
    }

    return {
      data: {
        id: company.id,
        name: company.name,
        contact: company.contact,
        createdAt: company.createdAt,
        workspaces: company.workspaces,
        workspaceCount: company._count.workspaces,
      },
    };
  }

  @Post()
  async create(@Req() req: Request, @Body() body: { name: string; contact?: string }) {
    await this.requireUser(req);
    const { name, contact } = body;

    if (!name?.trim()) {
      throw new HttpException('Name is required', HttpStatus.BAD_REQUEST);
    }

    const company = await this.prisma.company.create({
      data: { name: name.trim(), contact: contact?.trim() || null },
    });

    return { data: company };
  }
}
