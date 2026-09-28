import 'reflect-metadata';

import { ClassSerializerInterceptor, RequestMethod, ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';

import { AppModule } from './app.module.js';
import { ENV } from './config/env.js';
import { getCorsOrigins, validationOptions } from './config/http.js';
import { HttpExceptionFilter } from './filters/http-exception.filter.js';
import { PrismaExceptionFilter } from './prisma/prisma-exception.filter.js';

/**
 * Configure and start the Nest HTTP API, validation, documentation, and graceful shutdown.
 *
 * @returns A promise that resolves when the operation completes.
 */
export async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });
  app.setGlobalPrefix('api', { exclude: [{ path: 'mcp', method: RequestMethod.POST }] });
  app.enableShutdownHooks();
  app.enableCors({ origin: getCorsOrigins(ENV.CORS_ORIGIN) });
  app.useGlobalPipes(new ValidationPipe(validationOptions));
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
  app.useGlobalFilters(new PrismaExceptionFilter(), new HttpExceptionFilter());

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('ezRepo API')
      .setDescription('Read-only workflow status tracking API.')
      .setVersion('1.0')
      .addBearerAuth()
      .addServer(ENV.PUBLIC_URL)
      .build(),
  );

  app.use(
    '/docs',
    apiReference({
      content: document,
      hideClientButton: true,
      metaData: {
        title: 'ezRepo API',
      },
      telemetry: false,
    }),
  );

  await app.listen(ENV.PORT);
}

void bootstrap();
