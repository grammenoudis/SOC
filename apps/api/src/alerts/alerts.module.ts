import { Module } from '@nestjs/common';
import { AlertsController } from './alerts.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AlertsController],
})
export class AlertsModule {}
