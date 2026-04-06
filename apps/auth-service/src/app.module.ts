import { Module } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UserController } from './user.controller';
import { GoogleOAuthService } from './google-oauth.service';

@Module({
  controllers: [AuthController, UserController],
  providers: [AuthService, AuthGuard, GoogleOAuthService],
})
export class AppModule {}
