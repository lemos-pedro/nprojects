import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const host = process.env.API_GATEWAY_HOST ?? '0.0.0.0';
  const port = Number(process.env.API_GATEWAY_PORT ?? 3000);

  app.enableCors();
  app.setGlobalPrefix('');

  await app.listen(port, host);
  Logger.log(`api-gateway listening on http://${host}:${port}`, 'Bootstrap');
}

bootstrap().catch(error => {
  Logger.error(error, undefined, 'Bootstrap');
  process.exit(1);
});
