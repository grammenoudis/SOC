import { Controller, Get, Patch, Param, Query, Body, UseGuards } from '@nestjs/common';
import { AutoResponseService } from './auto-response.service';
import { AuthGuard } from '../common/guards/auth.guard';

@Controller('auto-response')
export class AutoResponseController {
  constructor(private readonly service: AutoResponseService) {}

  // Logger polls this — no auth (internal network only)
  @Get('pending')
  async getPending(@Query('workspaceId') workspaceId: string) {
    return this.service.getPending(workspaceId);
  }

  // Logger reports result — no auth (internal network only)
  @Patch('commands/:id')
  async updateCommand(
    @Param('id') id: string,
    @Body() body: { status: string; output?: string; retryCount?: number },
  ) {
    return this.service.updateCommand(id, body.status, body.output ?? null, body.retryCount);
  }

  // Frontend fetches auto-response for an alert
  @Get('alert/:alertId')
  @UseGuards(AuthGuard)
  async getByAlert(@Param('alertId') alertId: string) {
    const data = await this.service.getByAlert(alertId);
    return { data };
  }
}
