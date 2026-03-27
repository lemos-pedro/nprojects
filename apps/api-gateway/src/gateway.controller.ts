import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';

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
    return this.gatewayService.forwardAuthRequest('post', '/api/v1/auth/register', body);
  }

  @HttpCode(200)
  @Post('auth/login')
  login(@Body() body: Record<string, unknown>) {
    return this.gatewayService.forwardAuthRequest('post', '/api/v1/auth/login', body);
  }

  @HttpCode(200)
  @Post('auth/refresh')
  refresh(@Body() body: Record<string, unknown>) {
    return this.gatewayService.forwardAuthRequest('post', '/api/v1/auth/refresh', body);
  }

  @HttpCode(200)
  @Post('auth/logout')
  logout(@Body() body: Record<string, unknown>) {
    return this.gatewayService.forwardAuthRequest('post', '/api/v1/auth/logout', body);
  }

  @Get('me')
  getMe(@Headers('authorization') authorization?: string) {
    return this.gatewayService.forwardAuthRequest('get', '/api/v1/me', undefined, authorization);
  }

  @Get('users')
  getUsers(@Headers('authorization') authorization?: string) {
    return this.gatewayService.forwardAuthRequest('get', '/api/v1/users', undefined, authorization);
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
}
