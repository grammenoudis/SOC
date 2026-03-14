import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ReputationService } from './reputation.service';
import { ReputationController } from './reputation.controller';

@Module({
  imports: [PrismaModule],
  providers: [ReputationService],
  controllers: [ReputationController],
  exports: [ReputationService],
})
export class ReputationModule {}
