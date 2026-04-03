import 'reflect-metadata';
import 'module-alias/register';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { assertSecureEnv, createHttpObservabilityMiddleware, createRateLimitMiddleware } from '@ngola/shared';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  assertSecureEnv('project-service', [
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
    {
      name: 'STRIPE_WEBHOOK_SECRET',
      minLength: 12,
      disallowedValues: ['whsec_replace_me'],
    },
  ]);

  const app = await NestFactory.create(AppModule, { rawBody: true });
  const host = process.env.PROJECT_SERVICE_HOST ?? '0.0.0.0';
  const port = Number(process.env.PROJECT_SERVICE_PORT ?? 3003);

  app.enableCors();
  app.use(createHttpObservabilityMiddleware('project-service'));
  app.use(
    createRateLimitMiddleware('project-service', {
      defaultRule: {
        name: 'default',
        windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000),
        maxRequests: Number(process.env.PROJECT_SERVICE_RATE_LIMIT_MAX ?? 180),
      },
      rules: [
        {
          name: 'billing-checkout',
          pathPrefix: '/api/v1/billing/checkout-session',
          methods: ['POST'],
          windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000),
          maxRequests: Number(process.env.PROJECT_SERVICE_BILLING_RATE_LIMIT_MAX ?? 10),
        },
        {
          name: 'stripe-webhook',
          pathPrefix: '/api/v1/billing/webhooks/stripe',
          methods: ['POST'],
          windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000),
          maxRequests: Number(process.env.PROJECT_SERVICE_WEBHOOK_RATE_LIMIT_MAX ?? 120),
        },
      ],
      skipPathPrefixes: ['/api/v1/project-service/health'],
    }),
  );
  await app.listen(port, host);
  Logger.log(`project-service listening on http://${host}:${port}`, 'Bootstrap');
}

bootstrap().catch(error => {
  Logger.error(error, undefined, 'Bootstrap');
  process.exit(1);
});
