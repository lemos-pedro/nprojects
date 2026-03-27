import 'reflect-metadata';
import 'module-alias/register';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NextFunction, Request, Response } from 'express';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const host = process.env.VIDEO_SERVICE_HOST ?? '0.0.0.0';
  const port = Number(process.env.VIDEO_SERVICE_PORT ?? 3005);

  app.use('/api/v1/webhooks/livekit', (req: Request, _res: Response, next: NextFunction) => {
    const reqWithRawBody = req as Request & { rawBody?: Buffer };
    const chunks: Buffer[] = [];

    req.on('data', (chunk: Buffer) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    req.on('end', () => {
      reqWithRawBody.rawBody = Buffer.concat(chunks);
      next();
    });

    req.on('error', next);
  });
  app.setGlobalPrefix('api/v1');

  await app.listen(port, host);
  Logger.log(`video-service listening on http://${host}:${port}`, 'Bootstrap');
}

bootstrap().catch(error => {
  Logger.error(error, undefined, 'Bootstrap');
  process.exit(1);
});
