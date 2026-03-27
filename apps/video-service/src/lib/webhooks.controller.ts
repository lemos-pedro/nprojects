import { Controller, Headers, Logger, Post, Req } from '@nestjs/common';

import { MeetingsService } from './meetings.service';

@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(private readonly meetings: MeetingsService) {}

  @Post('livekit')
  handleLivekit(
    @Req() request: { rawBody?: Buffer; body?: unknown; headers?: Record<string, unknown> },
    @Headers('authorization') authorization?: string,
    @Headers('authorize') authorize?: string,
  ) {
    const rawBody = this.extractRawBody(request);
    this.logger.log(
      `LiveKit webhook request received: auth=${authorization ?? authorize ? 'present' : 'missing'} bytes=${
        rawBody.length
      } snippet=${rawBody.slice(0, 220)}`,
    );
    return this.meetings.handleWebhook(rawBody, authorization ?? authorize);
  }

  private extractRawBody(request: { rawBody?: Buffer; body?: unknown }): string {
    if (request.rawBody) {
      return request.rawBody.toString('utf8');
    }

    if (Buffer.isBuffer(request.body)) {
      return request.body.toString('utf8');
    }

    if (typeof request.body === 'string') {
      return request.body;
    }

    if (request.body && typeof request.body === 'object') {
      return JSON.stringify(request.body);
    }

    return '';
  }
}
