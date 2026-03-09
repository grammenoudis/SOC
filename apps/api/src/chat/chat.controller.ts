import { Controller, Get, Post, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../common/guards/auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ChatService } from './chat.service';
import type { ChatRequestDto } from '@soc/shared';

@Controller('chat')
@UseGuards(AuthGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  // list all conversations for the current user
  @Get('conversations')
  async listConversations(@CurrentUser() user: any) {
    const conversations = await this.chatService.listConversations(user.id);
    return { data: conversations };
  }

  // get a single conversation with its messages
  @Get('conversations/:id')
  async getConversation(@CurrentUser() user: any, @Param('id') id: string) {
    const conversation = await this.chatService.getConversation(user.id, id);
    return { data: conversation };
  }

  // delete a conversation
  @Delete('conversations/:id')
  async deleteConversation(@CurrentUser() user: any, @Param('id') id: string) {
    await this.chatService.deleteConversation(user.id, id);
    return { data: { id } };
  }

  // send a message (creates conversation if needed, persists everything)
  @Post('message')
  async sendMessage(@CurrentUser() user: any, @Body() body: ChatRequestDto) {
    const result = await this.chatService.sendMessage(user.id, body);
    return { data: result };
  }
}
