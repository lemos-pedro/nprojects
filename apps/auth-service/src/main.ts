import 'reflect-metadata';
import 'module-alias/register';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const host = process.env.AUTH_SERVICE_HOST ?? '0.0.0.0';
  const port = Number(process.env.AUTH_SERVICE_PORT ?? 3001);

  app.enableCors();
  app.setGlobalPrefix('');

  await app.listen(port, host);
  Logger.log(`auth-service listening on http://${host}:${port}`, 'Bootstrap');
}

bootstrap().catch(error => {
  Logger.error(error, undefined, 'Bootstrap');
  process.exit(1);
});
