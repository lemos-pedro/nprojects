import { Body, Controller, Get, Header, Param, Patch, Post, Query } from '@nestjs/common';

import { MeetingsService } from './meetings.service';
import { CreateMeetingDto, ParticipantRole, TokenRequestDto } from './meetings.types';

@Controller('meetings')
export class MeetingsController {
  constructor(private readonly meetings: MeetingsService) {}

  @Post()
  create(@Body() payload: CreateMeetingDto) {
    return this.meetings.create(payload);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.meetings.getMeeting(id);
  }

  @Post(':id/token')
  token(@Param('id') id: string, @Body() payload: TokenRequestDto) {
    return this.meetings.generateToken(id, payload);
  }

  @Patch(':id/end')
  end(@Param('id') id: string) {
    return this.meetings.endMeeting(id);
  }

  @Get(':id/summary')
  summary(@Param('id') id: string) {
    return this.meetings.getSummary(id);
  }

  @Get(':id/recording')
  recording(@Param('id') id: string) {
    return this.meetings.getRecording(id);
  }

  @Get(':id/demo')
  @Header('Content-Type', 'text/html; charset=utf-8')
  demo(
    @Param('id') id: string,
    @Query('userId') userId?: string,
    @Query('role') role?: ParticipantRole,
    @Query('name') name?: string,
  ) {
    return this.meetings.renderDemoPage(id, {
      userId: userId ?? `demo-${Date.now()}`,
      role: role ?? ParticipantRole.Viewer,
      name: name ?? 'Demo User',
    });
  }
}
