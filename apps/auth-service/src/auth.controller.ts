import { BadRequestException, Body, Controller, Get, HttpCode, Post, Query, UnauthorizedException, UseGuards } from '@nestjs/common';
import { randomUUID } from 'crypto';

import { AuthGuard } from './auth.guard';
import { CurrentUser } from './current-user.decorator';
import { AuthService, SafeAuthUser } from './auth.service';
import { LoginPayload, RegisterPayload } from './auth.types';
import { GoogleOAuthService } from './google-oauth.service';

@Controller('api/v1/auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly googleOAuth: GoogleOAuthService,
  ) {}

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

  @Get('google')
  googleLogin() {
    const state = randomUUID();
    const url = this.googleOAuth.buildAuthUrl(state);
    return { url };
  }

  @Get('google/callback')
  async googleCallback(
    @Query('code') code: string,
    @Query('error') error: string,
  ) {
    if (error || !code) {
      throw new BadRequestException('google_auth_cancelled');
    }

    try {
      const googleUser = await this.googleOAuth.exchangeCodeForUser(code);
      const { user, tokens } = await this.authService.loginWithGoogle(
        googleUser.email,
        googleUser.name,
      );

      return { user, tokens };
    } catch {
      throw new UnauthorizedException('google_auth_failed');
    }
  }
}