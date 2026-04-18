import { Body, Controller, Get, Header, Param, Patch, Post, Query } from '@nestjs/common';

import { MeetingsService } from './meetings.service';
import {
  AdmitParticipantDto,
  CreateMeetingDto,
  ParticipantRole,
  TokenRequestDto,
} from './meetings.types';

@Controller('meetings')
export class MeetingsController {
  constructor(private readonly meetingsService: MeetingsService) {}

  // ✅ ROTA PRINCIPAL - LISTAR REUNIÕES (corrigida)
  @Get()
  async findAll(@Query('tenantId') tenantId?: string) {
    return this.meetingsService.list(tenantId);
  }

  @Post()
  create(@Body() payload: CreateMeetingDto) {
    return this.meetingsService.create(payload);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.meetingsService.getMeeting(id);
  }

  @Post(':id/token')
  generateToken(@Param('id') id: string, @Body() payload: TokenRequestDto) {
    return this.meetingsService.generateToken(id, payload);
  }

  @Get(':id/waiting-room')
  getWaitingRoom(@Param('id') id: string) {
    return this.meetingsService.getWaitingRoom(id);
  }

  @Post(':id/admit')
  admitParticipant(@Param('id') id: string, @Body() payload: AdmitParticipantDto) {
    return this.meetingsService.admitParticipant(id, payload);
  }

  @Patch(':id/end')
  endMeeting(@Param('id') id: string) {
    return this.meetingsService.endMeeting(id);
  }

  @Get(':id/summary')
  getSummary(@Param('id') id: string) {
    return this.meetingsService.getSummary(id);
  }

  @Get(':id/recording')
  getRecording(@Param('id') id: string) {
    return this.meetingsService.getRecording(id);
  }

  @Get(':id/demo')
  @Header('Content-Type', 'text/html; charset=utf-8')
  renderDemo(
    @Param('id') id: string,
    @Query('userId') userId?: string,
    @Query('role') role?: ParticipantRole,
    @Query('name') name?: string,
    @Query('accessToken') accessToken?: string,
  ) {
    return this.meetingsService.renderDemoPage(id, {
      userId: userId ?? `demo-${Date.now()}`,
      role: role ?? ParticipantRole.Viewer,
      name: name ?? 'Demo User',
      accessToken,
    });
  }
}
