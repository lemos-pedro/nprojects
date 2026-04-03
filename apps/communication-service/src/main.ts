import 'reflect-metadata';
import 'module-alias/register';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createHttpObservabilityMiddleware, createRateLimitMiddleware } from '@ngola/shared';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const host = process.env.COMM_SERVICE_HOST ?? '0.0.0.0';
  const port = Number(process.env.COMM_SERVICE_PORT ?? 3004);

  app.enableCors();
  app.use(createHttpObservabilityMiddleware('communication-service'));
  app.use(
    createRateLimitMiddleware('communication-service', {
      defaultRule: {
        name: 'default',
        windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000),
        maxRequests: Number(process.env.COMM_SERVICE_RATE_LIMIT_MAX ?? 240),
      },
      skipPathPrefixes: ['/api/v1/health'],
    }),
  );
  await app.listen(port, host);
  Logger.log(`communication-service listening on http://${host}:${port}`, 'Bootstrap');
}

bootstrap().catch(error => {
  Logger.error(error, undefined, 'Bootstrap');
  process.exit(1);
});
