import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../common/guards/auth.guard';
import { ReputationService } from './reputation.service';

@Controller('reputation')
@UseGuards(AuthGuard)
export class ReputationController {
  constructor(private readonly reputation: ReputationService) {}

  @Get(':ip')
  async check(@Param('ip') ip: string) {
    const data = await this.reputation.lookup(ip);
    return { data };
  }
}
