import { Module } from '@nestjs/common';
import { LogsController } from './logs.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { ReputationModule } from '../reputation/reputation.module';

@Module({
  imports: [PrismaModule, ReputationModule],
  controllers: [LogsController],
})
export class LogsModule {}
