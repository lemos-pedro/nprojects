import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Response } from 'express';

import { GatewayService } from './gateway.service';

@Controller('api/v1')
export class GatewayController {
  constructor(private readonly gatewayService: GatewayService) {}

  @Get('health')
  getHealth(): Record<string, unknown> {
    return this.gatewayService.health();
  }

  @Get('auth/health')
  getAuthHealth() {
    return this.gatewayService.forwardAuthHealth();
  }

  @Post('auth/register')
  register(@Body() body: Record<string, unknown>) {
    return this.gatewayService.forwardAuthRequest('post', '/auth/register', body);
  }

  @HttpCode(200)
  @Post('auth/login')
  login(@Body() body: Record<string, unknown>) {
    return this.gatewayService.forwardAuthRequest('post', '/auth/login', body);
  }

  @HttpCode(200)
  @Post('auth/refresh')
  refresh(@Body() body: Record<string, unknown>) {
    return this.gatewayService.forwardAuthRequest('post', '/auth/refresh', body);
  }

  @HttpCode(200)
  @Post('auth/logout')
  logout(@Body() body: Record<string, unknown>) {
    return this.gatewayService.forwardAuthRequest('post', '/auth/logout', body);
  }

  @Get('auth/google')
  async googleLogin(@Res() res: Response) {
    const authServiceUrl = process.env.AUTH_SERVICE_URL ?? 'http://auth-service:3001';
    return res.redirect(`${authServiceUrl}/api/v1/auth/google`);
  }

  @Get('auth/google/callback')
  async googleCallback(
    @Query('code') code: string,
    @Query('error') error: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    const authServiceUrl = process.env.AUTH_SERVICE_URL ?? 'http://auth-service:3001';
    const params = new URLSearchParams();
    if (code) params.set('code', code);
    if (error) params.set('error', error);
    if (state) params.set('state', state);
    return res.redirect(`${authServiceUrl}/api/v1/auth/google/callback?${params.toString()}`);
  }

  @Get('me')
  getMe(@Headers('authorization') authorization?: string) {
    return this.gatewayService.forwardAuthRequest('get', '/me', undefined, authorization);
  }

  @Get('users')
  getUsers(@Headers('authorization') authorization?: string) {
    return this.gatewayService.forwardAuthRequest('get', '/users', undefined, authorization);
  }

  @Post('team/invite-link')
  createTeamInviteLink(
    @Body()
    body: {
      teamId?: string;
      teamName?: string;
      description?: string;
      email?: string;
      role?: 'admin' | 'manager' | 'member' | 'viewer' | 'guest';
      expiresInDays?: number;
    },
    @Headers('authorization') authorization?: string,
  ) {
    this.assertAuthorizationHeader(authorization);
    return this.gatewayService.forwardAuthRequest(
      'post',
      '/team/invite-link',
      body,
      authorization,
    );
  }

  @Post('team/join/:token')
  joinTeamByInviteToken(
    @Param('token') token: string,
    @Body() body: { email?: string; fullName?: string; password?: string },
  ) {
    return this.gatewayService.forwardAuthRequest('post', `/api/v1/team/join/${token}`, body);
  }

  @Post('auth/2fa/enable')
  enableTwoFactor(@Headers('authorization') authorization?: string) {
    return this.gatewayService.forwardAuthRequest(
      'post',
      '/api/v1/auth/2fa/enable',
      undefined,
      authorization,
    );
  }

  @Post('auth/2fa/verify')
  verifyTwoFactor(
    @Body() body: Record<string, unknown>,
    @Headers('authorization') authorization?: string,
  ) {
    return this.gatewayService.forwardAuthRequest(
      'post',
      '/api/v1/auth/2fa/verify',
      body,
      authorization,
    );
  }

  @Post('tenants')
  createTenant(@Body() body: Record<string, unknown>, @Headers('authorization') authorization?: string) {
    return this.gatewayService.forwardProjectRequest('post', '/api/v1/tenants', body, authorization);
  }

  @Post('tenants/onboarding')
  onboardingTenant(@Body() body: Record<string, unknown>, @Headers('authorization') authorization?: string) {
    return this.gatewayService.forwardProjectRequest(
      'post',
      '/api/v1/tenants/onboarding',
      body,
      authorization,
    );
  }

  @Get('tenants')
  getTenants(@Headers('authorization') authorization?: string) {
    return this.gatewayService.forwardProjectRequest('get', '/api/v1/tenants', undefined, authorization);
  }

  @Get('tenants/:id')
  getTenant(@Param('id') id: string, @Headers('authorization') authorization?: string) {
    return this.gatewayService.forwardProjectRequest('get', `/api/v1/tenants/${id}`, undefined, authorization);
  }

  @Patch('tenants/:id')
  updateTenant(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Headers('authorization') authorization?: string,
  ) {
    return this.gatewayService.forwardProjectRequest('patch', `/api/v1/tenants/${id}`, body, authorization);
  }

  @Delete('tenants/:id')
  deleteTenant(@Param('id') id: string, @Headers('authorization') authorization?: string) {
    return this.gatewayService.forwardProjectRequest(
      'delete',
      `/api/v1/tenants/${id}`,
      undefined,
      authorization,
    );
  }

  @Post('projects/templates')
  createTemplate(@Body() body: Record<string, unknown>, @Headers('authorization') authorization?: string) {
    return this.gatewayService.forwardProjectRequest(
      'post',
      '/api/v1/projects/templates',
      body,
      authorization,
    );
  }

  @Get('projects/templates')
  getTemplates(@Query('industry') industry: string | undefined, @Headers('authorization') authorization?: string) {
    return this.gatewayService.forwardProjectRequest(
      'get',
      '/api/v1/projects/templates',
      undefined,
      authorization,
      { industry },
    );
  }

  @Post('projects')
  createProject(@Body() body: Record<string, unknown>, @Headers('authorization') authorization?: string) {
    return this.gatewayService.forwardProjectRequest('post', '/api/v1/projects', body, authorization);
  }

  @Get('projects')
  getProjects(@Query('tenantId') tenantId: string | undefined, @Headers('authorization') authorization?: string) {
    return this.gatewayService.forwardProjectRequest('get', '/api/v1/projects', undefined, authorization, {
      tenantId,
    });
  }

  @Get('projects/:id')
  getProject(@Param('id') id: string, @Headers('authorization') authorization?: string) {
    return this.gatewayService.forwardProjectRequest('get', `/api/v1/projects/${id}`, undefined, authorization);
  }

  @Patch('projects/:id')
  updateProject(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Headers('authorization') authorization?: string,
  ) {
    return this.gatewayService.forwardProjectRequest('patch', `/api/v1/projects/${id}`, body, authorization);
  }

  @Delete('projects/:id')
  deleteProject(@Param('id') id: string, @Headers('authorization') authorization?: string) {
    return this.gatewayService.forwardProjectRequest(
      'delete',
      `/api/v1/projects/${id}`,
      undefined,
      authorization,
    );
  }

  @Post('phases')
  createPhase(@Body() body: Record<string, unknown>, @Headers('authorization') authorization?: string) {
    return this.gatewayService.forwardProjectRequest('post', '/api/v1/phases', body, authorization);
  }

  @Get('phases')
  getPhases(@Query('projectId') projectId: string | undefined, @Headers('authorization') authorization?: string) {
    return this.gatewayService.forwardProjectRequest('get', '/api/v1/phases', undefined, authorization, {
      projectId,
    });
  }

  @Patch('phases/:id')
  updatePhase(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Headers('authorization') authorization?: string,
  ) {
    return this.gatewayService.forwardProjectRequest('patch', `/api/v1/phases/${id}`, body, authorization);
  }

  @Delete('phases/:id')
  deletePhase(@Param('id') id: string, @Headers('authorization') authorization?: string) {
    return this.gatewayService.forwardProjectRequest(
      'delete',
      `/api/v1/phases/${id}`,
      undefined,
      authorization,
    );
  }

  @Post('labels')
  createLabel(@Body() body: Record<string, unknown>, @Headers('authorization') authorization?: string) {
    return this.gatewayService.forwardProjectRequest('post', '/api/v1/labels', body, authorization);
  }

  @Get('labels')
  getLabels(@Query('tenantId') tenantId: string | undefined, @Headers('authorization') authorization?: string) {
    return this.gatewayService.forwardProjectRequest('get', '/api/v1/labels', undefined, authorization, {
      tenantId,
    });
  }

  @Post('tasks')
  createTask(@Body() body: Record<string, unknown>, @Headers('authorization') authorization?: string) {
    return this.gatewayService.forwardProjectRequest('post', '/api/v1/tasks', body, authorization);
  }

  @Get('tasks')
  getTasks(@Query('projectId') projectId: string | undefined, @Headers('authorization') authorization?: string) {
    return this.gatewayService.forwardProjectRequest('get', '/api/v1/tasks', undefined, authorization, {
      projectId,
    });
  }

  @Get('tasks/:id')
  getTask(@Param('id') id: string, @Headers('authorization') authorization?: string) {
    return this.gatewayService.forwardProjectRequest('get', `/api/v1/tasks/${id}`, undefined, authorization);
  }

  @Patch('tasks/:id')
  updateTask(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Headers('authorization') authorization?: string,
  ) {
    return this.gatewayService.forwardProjectRequest('patch', `/api/v1/tasks/${id}`, body, authorization);
  }

  @Delete('tasks/:id')
  deleteTask(@Param('id') id: string, @Headers('authorization') authorization?: string) {
    return this.gatewayService.forwardProjectRequest(
      'delete',
      `/api/v1/tasks/${id}`,
      undefined,
      authorization,
    );
  }

  @Get('billing/plans')
  getBillingPlans(@Headers('authorization') authorization?: string) {
    this.assertAuthorizationHeader(authorization);
    return this.gatewayService.forwardProjectRequest(
      'get',
      '/api/v1/billing/plans',
      undefined,
      authorization,
    );
  }

  @Get('billing/subscription/:tenantId')
  getBillingSubscription(
    @Param('tenantId') tenantId: string,
    @Headers('authorization') authorization?: string,
  ) {
    this.assertAuthorizationHeader(authorization);
    return this.gatewayService.forwardProjectRequest(
      'get',
      `/api/v1/billing/subscription/${tenantId}`,
      undefined,
      authorization,
    );
  }

  @Post('billing/checkout-session')
  createBillingCheckoutSession(
    @Body() body: Record<string, unknown>,
    @Headers('authorization') authorization?: string,
  ) {
    this.assertAuthorizationHeader(authorization);
    return this.gatewayService.forwardProjectRequest(
      'post',
      '/api/v1/billing/checkout-session',
      body,
      authorization,
    );
  }

  private assertAuthorizationHeader(authorization?: string): void {
    if (!authorization || !authorization.toLowerCase().startsWith('bearer ')) {
      throw new UnauthorizedException('authorization token is required');
    }
  }

  // ==================== MEETINGS ====================

  @Post('meetings')
  createMeeting(@Body() body: Record<string, unknown>, @Headers('authorization') authorization?: string) {
    return this.gatewayService.forwardVideoRequest('post', '/api/v1/meetings', body, authorization);
  }

  @Get('meetings')
  getMeetings(@Query('tenantId') tenantId: string | undefined, @Headers('authorization') authorization?: string) {
    return this.gatewayService.forwardVideoRequest('get', '/api/v1/meetings', undefined, authorization, { tenantId });
  }

  @Get('meetings/:id')
  getMeeting(@Param('id') id: string, @Headers('authorization') authorization?: string) {
    return this.gatewayService.forwardVideoRequest('get', `/api/v1/meetings/${id}`, undefined, authorization);
  }

  @Post('meetings/:id/token')
  getMeetingToken(@Param('id') id: string, @Body() body: Record<string, unknown>, @Headers('authorization') authorization?: string) {
    return this.gatewayService.forwardVideoRequest('post', `/api/v1/meetings/${id}/token`, body, authorization);
  }

  @Patch('meetings/:id/end')
  endMeeting(@Param('id') id: string, @Headers('authorization') authorization?: string) {
    return this.gatewayService.forwardVideoRequest('patch', `/api/v1/meetings/${id}/end`, undefined, authorization);
  }

  @Get('meetings/:id/summary')
  getMeetingSummary(@Param('id') id: string, @Headers('authorization') authorization?: string) {
    return this.gatewayService.forwardVideoRequest('get', `/api/v1/meetings/${id}/summary`, undefined, authorization);
  }

  // ==================== NOTIFICATIONS ====================

  @Get('notifications')
  getNotifications(@Query('userId') userId: string | undefined, @Headers('authorization') authorization?: string) {
    return this.gatewayService.forwardCommRequest('get', '/notifications', undefined, authorization, { userId });
  }

  @Post('notifications/:id/read')
  markNotificationRead(@Param('id') id: string, @Headers('authorization') authorization?: string) {
    return this.gatewayService.forwardCommRequest('post', `/notifications/${id}/read`, undefined, authorization);
  }

  @Post('notifications/read-all')
  markAllNotificationsRead(@Body() body: Record<string, unknown>, @Headers('authorization') authorization?: string) {
    return this.gatewayService.forwardCommRequest('post', '/notifications/read-all', body, authorization);
  }

  // ==================== CHANNELS ====================

  @Post('channels')
  createChannel(@Body() body: Record<string, unknown>, @Headers('authorization') authorization?: string) {
    return this.gatewayService.forwardCommRequest('post', '/channels', body, authorization);
  }

  @Get('channels')
  getChannels(@Query('userId') userId: string | undefined, @Headers('authorization') authorization?: string) {
    return this.gatewayService.forwardCommRequest('get', '/channels', undefined, authorization, { userId });
  }

  @Get('channels/:id')
  getChannel(@Param('id') id: string, @Headers('authorization') authorization?: string) {
    return this.gatewayService.forwardCommRequest('get', `/channels/${id}`, undefined, authorization);
  }

  // ==================== MESSAGES ====================

  @Post('messages')
  sendMessage(@Body() body: Record<string, unknown>, @Headers('authorization') authorization?: string) {
    return this.gatewayService.forwardCommRequest('post', '/messages', body, authorization);
  }

  @Get('messages/:channelId')
  getMessages(@Param('channelId') channelId: string, @Headers('authorization') authorization?: string) {
    return this.gatewayService.forwardCommRequest('get', `/messages/${channelId}`, undefined, authorization);
  }
}