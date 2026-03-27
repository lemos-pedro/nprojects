import { Controller, Get } from '@nestjs/common';

@Controller('api/v1')
export class HealthController {
  @Get('health')
  health() {
    return {
      service: 'communication-service',
      status: 'ok',
    };
  }
}
