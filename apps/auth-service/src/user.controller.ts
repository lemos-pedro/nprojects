import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';

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
  getUsers(@CurrentUser() user: SafeAuthUser) {
    return this.authService.getUsers(user.tenantId);
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
