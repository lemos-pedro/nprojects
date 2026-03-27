import { Body, Controller, Get, Param, Post } from '@nestjs/common';

import { MessagesService } from './messages.service';
import { CreateMessageDto, EditMessageDto, ReactionDto } from './messages.types';

@Controller('messages')
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Post()
  create(@Body() payload: CreateMessageDto) {
    return this.messages.create(payload);
  }

  @Get(':channelId')
  list(@Param('channelId') channelId: string) {
    return this.messages.listByChannel(channelId);
  }

  @Post(':messageId/edit')
  edit(@Param('messageId') messageId: string, @Body() payload: EditMessageDto) {
    return this.messages.edit(messageId, payload);
  }

  @Post(':messageId/delete')
  softDelete(@Param('messageId') messageId: string) {
    return this.messages.softDelete(messageId);
  }

  @Post(':messageId/pin')
  pin(@Param('messageId') messageId: string) {
    return this.messages.setPinned(messageId, true);
  }

  @Post(':messageId/unpin')
  unpin(@Param('messageId') messageId: string) {
    return this.messages.setPinned(messageId, false);
  }

  @Post(':messageId/reactions')
  react(@Param('messageId') messageId: string, @Body() payload: ReactionDto) {
    return this.messages.addReaction(messageId, payload);
  }
}
