import 'reflect-metadata';
import 'module-alias/register';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { assertSecureEnv, createHttpObservabilityMiddleware, createRateLimitMiddleware } from '@ngola/shared';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  assertSecureEnv('auth-service', [
    {
      name: 'AUTH_JWT_ACCESS_SECRET',
      minLength: 24,
      disallowedValues: ['dev-access-secret', 'replace-access-secret'],
    },
    {
      name: 'AUTH_JWT_REFRESH_SECRET',
      minLength: 24,
      disallowedValues: ['dev-refresh-secret', 'replace-refresh-secret'],
    },
    {
      name: 'INTERNAL_SERVICE_TOKEN',
      minLength: 24,
      disallowedValues: ['replace-internal-service-token'],
    },
  ]);

  const app = await NestFactory.create(AppModule);
  const host = process.env.AUTH_SERVICE_HOST ?? '0.0.0.0';
  const port = Number(process.env.AUTH_SERVICE_PORT ?? 3001);

  app.enableCors();
  app.use(createHttpObservabilityMiddleware('auth-service'));
  app.use(
    createRateLimitMiddleware('auth-service', {
      defaultRule: {
        name: 'default',
        windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000),
        maxRequests: Number(process.env.AUTH_SERVICE_RATE_LIMIT_MAX ?? 120),
      },
      rules: [
        {
          name: 'auth-sensitive',
          pathPrefix: '/api/v1/auth/',
          windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000),
          maxRequests: Number(process.env.AUTH_SERVICE_AUTH_RATE_LIMIT_MAX ?? 20),
        },
      ],
      skipPathPrefixes: ['/api/v1/auth/health'],
    }),
  );
  app.setGlobalPrefix('');

  await app.listen(port, host);
  Logger.log(`auth-service listening on http://${host}:${port}`, 'Bootstrap');
}

bootstrap().catch(error => {
  Logger.error(error, undefined, 'Bootstrap');
  process.exit(1);
});
