import 'reflect-metadata';
import 'module-alias/register';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { assertSecureEnv, createHttpObservabilityMiddleware, createRateLimitMiddleware } from '@ngola/shared';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  assertSecureEnv('api-gateway', [
    {
      name: 'AUTH_JWT_ACCESS_SECRET',
      minLength: 24,
      disallowedValues: ['dev-access-secret', 'replace-access-secret'],
    },
    {
      name: 'INTERNAL_SERVICE_TOKEN',
      minLength: 24,
      disallowedValues: ['replace-internal-service-token'],
    },
  ]);

  const app = await NestFactory.create(AppModule);
  const host = process.env.API_GATEWAY_HOST ?? '0.0.0.0';
  const port = Number(process.env.API_GATEWAY_PORT ?? 3000);

  app.use(helmet());
  app.enableCors({
    origin: ['https://app.drucci.pt', 'https://api.drucci.pt'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'X-Requested-With'],
    exposedHeaders: ['Authorization'],
    credentials: true,
    maxAge: 86400,
  });
  app.use(createHttpObservabilityMiddleware('api-gateway'));
  app.use(
    createRateLimitMiddleware('api-gateway', {
      defaultRule: {
        name: 'default',
        windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000),
        maxRequests: Number(process.env.API_GATEWAY_RATE_LIMIT_MAX ?? 240),
      },
      rules: [
        {
          name: 'auth',
          pathPrefix: '/api/v1/auth/',
          windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000),
          maxRequests: Number(process.env.API_GATEWAY_AUTH_RATE_LIMIT_MAX ?? 20),
        },
        {
          name: 'billing-checkout',
          pathPrefix: '/api/v1/billing/checkout-session',
          methods: ['POST'],
          windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000),
          maxRequests: Number(process.env.API_GATEWAY_BILLING_RATE_LIMIT_MAX ?? 10),
        },
      ],
      skipPathPrefixes: ['/api/v1/health'],
    }),
  );
  app.setGlobalPrefix('');

  await app.listen(port, host);
  Logger.log(`api-gateway listening on http://${host}:${port}`, 'Bootstrap');
}

bootstrap().catch(error => {
  Logger.error(error, undefined, 'Bootstrap');
  process.exit(1);
});
