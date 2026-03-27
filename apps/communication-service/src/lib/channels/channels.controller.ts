import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';

import { ChannelsService } from './channels.service';
import { CreateChannelDto } from './channels.types';

@Controller('channels')
export class ChannelsController {
  constructor(private readonly channels: ChannelsService) {}

  @Post()
  create(@Body() payload: CreateChannelDto) {
    return this.channels.create(payload);
  }

  @Get()
  list(@Query('userId') userId?: string) {
    return this.channels.list(userId);
  }

  @Get(':channelId')
  findOne(@Param('channelId') channelId: string) {
    return this.channels.findById(channelId);
  }
}
