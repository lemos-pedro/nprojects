import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';

import { AuthGuard } from './auth.guard';
import { CurrentUser } from './current-user.decorator';
import { AuthService } from './auth.service';
import { LoginPayload, RegisterPayload } from './auth.types';
import { SafeAuthUser } from './auth.service';

@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('health')
  getHealth(): Record<string, unknown> {
    return this.authService.health();
  }

  @Post('register')
  register(@Body() payload: RegisterPayload) {
    return this.authService.register(payload);
  }

  @HttpCode(200)
  @Post('login')
  login(@Body() payload: LoginPayload) {
    return this.authService.login(payload);
  }

  @HttpCode(200)
  @Post('refresh')
  refresh(@Body('refreshToken') refreshToken: string) {
    return this.authService.refresh(refreshToken);
  }

  @HttpCode(200)
  @Post('logout')
  logout(@Body('refreshToken') refreshToken: string) {
    return this.authService.logout(refreshToken);
  }

  @UseGuards(AuthGuard)
  @Post('2fa/enable')
  enableTwoFactor(@CurrentUser() user: SafeAuthUser) {
    return this.authService.enableTwoFactor(user.id);
  }

  @UseGuards(AuthGuard)
  @Post('2fa/verify')
  verifyTwoFactor(@CurrentUser() user: SafeAuthUser, @Body('code') code: string) {
    return this.authService.verifyTwoFactor(user.id, code);
  }
}
