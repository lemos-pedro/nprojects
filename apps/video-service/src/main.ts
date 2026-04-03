import 'reflect-metadata';
import 'module-alias/register';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NextFunction, Request, Response } from 'express';
import { assertSecureEnv, createHttpObservabilityMiddleware, createRateLimitMiddleware } from '@ngola/shared';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  assertSecureEnv('video-service', [
    {
      name: 'INTERNAL_SERVICE_TOKEN',
      minLength: 24,
      disallowedValues: ['replace-internal-service-token'],
    },
    {
      name: 'LIVEKIT_API_SECRET',
      minLength: 16,
      disallowedValues: ['devsecret1234567890abcdef'],
    },
  ]);

  const app = await NestFactory.create(AppModule, { rawBody: true });

  const host = process.env.VIDEO_SERVICE_HOST ?? '0.0.0.0';
  const port = Number(process.env.VIDEO_SERVICE_PORT ?? 3005);

  // ==================== CORS ====================
  app.enableCors({
    origin: 'http://localhost:8080', // Frontend
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'Accept',
      'Origin',
    ],
    exposedHeaders: ['Authorization'],
    preflightContinue: false,
    optionsSuccessStatus: 204,
    maxAge: 86400,
  });

  // ==================== HANDLE PRE-FLIGHT OPTIONS ====================
  // Garante que qualquer preflight OPTIONS não seja bloqueado
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'OPTIONS') {
      res.header('Access-Control-Allow-Origin', 'http://localhost:8080');
      res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Requested-With,Accept,Origin');
      res.header('Access-Control-Allow-Credentials', 'true');
      return res.sendStatus(204);
    }
    next();
  });

  // ==================== GLOBAL PREFIX ====================
  app.setGlobalPrefix('api/v1');

  // ==================== MIDDLEWARES ====================
  app.use(createHttpObservabilityMiddleware('video-service'));

  // Rate limiter (não bloqueia OPTIONS)
  app.use(
    createRateLimitMiddleware('video-service', {
      defaultRule: {
        name: 'default',
        windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000),
        maxRequests: Number(process.env.VIDEO_SERVICE_RATE_LIMIT_MAX ?? 180),
      },
      rules: [
        {
          name: 'meeting-token',
          pathPrefix: '/api/v1/meetings',
          methods: ['POST'],
          windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000),
          maxRequests: Number(process.env.VIDEO_SERVICE_TOKEN_RATE_LIMIT_MAX ?? 30),
        },
      ],
      skipPathPrefixes: [
        '/api/v1/health',
        '/api/v1/webhooks/livekit',
        '/api/v1/meetings',
      ],
    }),
  );

  // Webhook raw body (LiveKit)
  app.use('/api/v1/webhooks/livekit', (req: Request, _res: Response, next: NextFunction) => {
    const reqWithRawBody = req as Request & { rawBody?: Buffer };
    const chunks: Buffer[] = [];

    req.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    req.on('end', () => {
      reqWithRawBody.rawBody = Buffer.concat(chunks);
      next();
    });

    req.on('error', next);
  });

  await app.listen(port, host);
  Logger.log(`video-service listening on http://${host}:${port}`, 'Bootstrap');
}

bootstrap().catch(error => {
  Logger.error(error, undefined, 'Bootstrap');
  process.exit(1);
});