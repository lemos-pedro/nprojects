import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';

import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@Query('userId') userId: string) {
    return this.notifications.list(userId);
  }

  @Post(':notificationId/read')
  markRead(@Param('notificationId') notificationId: string) {
    return this.notifications.markRead(notificationId);
  }

  @Post('read-all')
  markAll(@Body('userId') userId: string) {
    return this.notifications.markAll(userId);
  }
}
