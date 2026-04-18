import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { MeetingsController } from './lib/meetings.controller';
import { MeetingsService } from './lib/meetings.service';
import { WebhooksController } from './lib/webhooks.controller';
import { VideoAuthGuard } from './video-auth.guard';

@Module({
  controllers: [MeetingsController, WebhooksController],
  providers: [
    MeetingsService,
    {
      provide: APP_GUARD,
      useClass: VideoAuthGuard,
    },
  ],
})
export class AppModule {}
