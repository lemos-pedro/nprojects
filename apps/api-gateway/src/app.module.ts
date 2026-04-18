import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { GatewayController } from './gateway.controller';
import { GatewayAuthGuard } from './gateway-auth.guard';
import { GatewayService } from './gateway.service';

@Module({
  controllers: [GatewayController],
  providers: [
    GatewayService,
    {
      provide: APP_GUARD,
      useClass: GatewayAuthGuard,
    },
  ],
})
export class AppModule {}
