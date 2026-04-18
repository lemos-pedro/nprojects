import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';

import { AuthGuard } from './auth.guard';
import { AuthService, SafeAuthUser } from './auth.service';
import { CurrentUser } from './current-user.decorator';

@Controller('api/v1')
export class UserController {
  constructor(private readonly authService: AuthService) {}

  @UseGuards(AuthGuard)
  @Get('me')
  getMe(@CurrentUser() user: SafeAuthUser) {
    return this.authService.getProfile(user.id);
  }

  @UseGuards(AuthGuard)
  @Get('users')
  getUsers(@CurrentUser() user: SafeAuthUser, @Query('teamId') teamId?: string) {
    return this.authService.getUsersByTenant(user.tenantId, teamId);
  }

  @UseGuards(AuthGuard)
  @Get('teams')
  getTeams(@CurrentUser() user: SafeAuthUser) {
    return this.authService.listTeamsForUser(user);
  }

  @UseGuards(AuthGuard)
  @Get('teams/:teamId/members')
  getTeamMembers(@CurrentUser() user: SafeAuthUser, @Param('teamId') teamId: string) {
    return this.authService.getTeamMembers(user, teamId);
  }

  @UseGuards(AuthGuard)
  @Post('team/invite-link')
  createTeamInviteLink(
    @CurrentUser() user: SafeAuthUser,
    @Body()
    payload: {
      teamId?: string;
      teamName?: string;
      description?: string;
      email?: string;
      role?: 'admin' | 'manager' | 'member' | 'viewer' | 'guest';
      expiresInDays?: number;
    },
  ) {
    return this.authService.createTeamInviteLink(user, payload);
  }

  @Post('team/join/:token')
  joinTeamByInviteToken(
    @Param('token') token: string,
    @Body()
    payload: {
      email?: string;
      fullName?: string;
      password?: string;
    },
  ) {
    return this.authService.joinTeamByInviteToken(token, payload);
  }
}
