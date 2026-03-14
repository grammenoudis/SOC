import { Module } from '@nestjs/common';
import { AutoResponseController } from './auto-response.controller';
import { AutoResponseService } from './auto-response.service';
import { PrismaModule } from '../prisma/prisma.module';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [PrismaModule, EventsModule],
  controllers: [AutoResponseController],
  providers: [AutoResponseService],
  exports: [AutoResponseService],
})
export class AutoResponseModule {}
