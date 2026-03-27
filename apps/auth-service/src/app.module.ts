import { Module } from '@nestjs/common';

import { AuthGuard } from './auth.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UserController } from './user.controller';

@Module({
  controllers: [AuthController, UserController],
  providers: [AuthService, AuthGuard],
})
export class AppModule {}
