import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { CommunicationAuthGuard } from './communication-auth.guard';
import { ChannelsController } from './lib/channels/channels.controller';
import { ChannelsService } from './lib/channels/channels.service';
import { MessagesController } from './lib/messages/messages.controller';
import { MessagesService } from './lib/messages/messages.service';
import { NotificationsController } from './lib/notifications/notifications.controller';
import { NotificationsService } from './lib/notifications/notifications.service';
import { SocketGateway } from './lib/socket/socket.gateway';
import { HealthController } from './health.controller';

@Module({
  controllers: [HealthController, ChannelsController, MessagesController, NotificationsController],
  providers: [
    ChannelsService,
    MessagesService,
    NotificationsService,
    SocketGateway,
    {
      provide: APP_GUARD,
      useClass: CommunicationAuthGuard,
    },
  ],
})
export class AppModule {}
