import 'reflect-metadata';
import 'module-alias/register';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const host = process.env.PROJECT_SERVICE_HOST ?? '0.0.0.0';
  const port = Number(process.env.PROJECT_SERVICE_PORT ?? 3003);

  app.enableCors();
  await app.listen(port, host);
  Logger.log(`project-service listening on http://${host}:${port}`, 'Bootstrap');
}

bootstrap().catch(error => {
  Logger.error(error, undefined, 'Bootstrap');
  process.exit(1);
});
