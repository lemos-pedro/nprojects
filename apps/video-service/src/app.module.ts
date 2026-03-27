import { Module } from '@nestjs/common';

import { MeetingsController } from './lib/meetings.controller';
import { MeetingsService } from './lib/meetings.service';
import { WebhooksController } from './lib/webhooks.controller';

@Module({
  controllers: [MeetingsController, WebhooksController],
  providers: [MeetingsService],
})
export class AppModule {}
