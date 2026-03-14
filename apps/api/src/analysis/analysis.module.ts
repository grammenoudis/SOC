import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AnalysisService } from './analysis.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ReputationModule } from '../reputation/reputation.module';
import { AutoResponseModule } from '../auto-response/auto-response.module';

@Module({
  imports: [PrismaModule, ScheduleModule.forRoot(), ReputationModule, AutoResponseModule],
  providers: [AnalysisService],
})
export class AnalysisModule {}
