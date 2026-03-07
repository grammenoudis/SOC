import { Controller, Get, Post, Delete, Param, Req, HttpException, HttpStatus } from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { auth } from '../auth/auth';

@Controller('favorites')
export class FavoritesController {
  constructor(private readonly prisma: PrismaService) {}

  private async requireUser(req: Request) {
    const session = await auth.api.getSession({ headers: req.headers as any });
    if (!session?.user) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }
    return session.user;
  }

  @Get()
  async getFavorites(@Req() req: Request) {
    const user = await this.requireUser(req);
    const favorites = await this.prisma.favoriteCompany.findMany({
      where: { userId: user.id },
      select: { companyId: true },
    });
    return { data: favorites.map((f) => f.companyId) };
  }

  @Post(':companyId')
  async addFavorite(@Req() req: Request, @Param('companyId') companyId: string) {
    const user = await this.requireUser(req);

    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) {
      throw new HttpException('Company not found', HttpStatus.NOT_FOUND);
    }

    await this.prisma.favoriteCompany.upsert({
      where: { userId_companyId: { userId: user.id, companyId } },
      create: { userId: user.id, companyId },
      update: {},
    });

    return { data: { companyId } };
  }

  @Delete(':companyId')
  async removeFavorite(@Req() req: Request, @Param('companyId') companyId: string) {
    const user = await this.requireUser(req);

    await this.prisma.favoriteCompany.deleteMany({
      where: { userId: user.id, companyId },
    });

    return { data: { companyId } };
  }
}
