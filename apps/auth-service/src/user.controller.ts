import { Controller, Get, UseGuards } from '@nestjs/common';

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
}
