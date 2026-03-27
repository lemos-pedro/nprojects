import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';

import { ProjectService } from './project.service';

@Controller('api/v1')
export class ProjectController {
  constructor(private readonly projectService: ProjectService) {}

  @Get('project-service/health')
  getHealth() {
    return this.projectService.health();
  }

  @Post('tenants')
  createTenant(@Body() body: Record<string, unknown>) {
    return this.projectService.createTenant(body);
  }

  @Post('tenants/onboarding')
  onboardingTenant(@Body() body: Record<string, unknown>) {
    return this.projectService.onboardingTenant(body);
  }

  @Get('tenants')
  getTenants() {
    return this.projectService.getTenants();
  }

  @Get('tenants/:id')
  getTenant(@Param('id') id: string) {
    return this.projectService.getTenant(id);
  }

  @Patch('tenants/:id')
  updateTenant(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.projectService.updateTenant(id, body);
  }

  @Delete('tenants/:id')
  deleteTenant(@Param('id') id: string) {
    return this.projectService.deleteTenant(id);
  }

  @Post('projects/templates')
  createTemplate(@Body() body: Record<string, unknown>) {
    return this.projectService.createTemplate(body);
  }

  @Get('projects/templates')
  getTemplates(@Query('industry') industry?: string) {
    return this.projectService.getTemplates(industry);
  }

  @Post('projects')
  createProject(@Body() body: Record<string, unknown>) {
    return this.projectService.createProject(body);
  }

  @Get('projects')
  getProjects(@Query('tenantId') tenantId?: string) {
    return this.projectService.getProjects(tenantId);
  }

  @Get('projects/:id')
  getProject(@Param('id') id: string) {
    return this.projectService.getProject(id);
  }

  @Patch('projects/:id')
  updateProject(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.projectService.updateProject(id, body);
  }

  @Delete('projects/:id')
  deleteProject(@Param('id') id: string) {
    return this.projectService.deleteProject(id);
  }

  @Post('phases')
  createPhase(@Body() body: Record<string, unknown>) {
    return this.projectService.createPhase(body);
  }

  @Get('phases')
  getPhases(@Query('projectId') projectId?: string) {
    return this.projectService.getPhases(projectId);
  }

  @Patch('phases/:id')
  updatePhase(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.projectService.updatePhase(id, body);
  }

  @Delete('phases/:id')
  deletePhase(@Param('id') id: string) {
    return this.projectService.deletePhase(id);
  }

  @Post('labels')
  createLabel(@Body() body: Record<string, unknown>) {
    return this.projectService.createLabel(body);
  }

  @Get('labels')
  getLabels(@Query('tenantId') tenantId?: string) {
    return this.projectService.getLabels(tenantId);
  }

  @Post('tasks')
  createTask(@Body() body: Record<string, unknown>) {
    return this.projectService.createTask(body);
  }

  @Get('tasks')
  getTasks(@Query('projectId') projectId?: string) {
    return this.projectService.getTasks(projectId);
  }

  @Get('tasks/:id')
  getTask(@Param('id') id: string) {
    return this.projectService.getTask(id);
  }

  @Patch('tasks/:id')
  updateTask(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.projectService.updateTask(id, body);
  }

  @HttpCode(200)
  @Delete('tasks/:id')
  deleteTask(@Param('id') id: string) {
    return this.projectService.deleteTask(id);
  }
}
