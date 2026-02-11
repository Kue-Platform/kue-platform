import './instrument';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { setAppInstance } from './inngest/inngest-app.context';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  const configService = app.get(ConfigService);

  // Configure CORS to allow credentials (cookies)
  app.enableCors({
    origin: [
      configService.get<string>('FRONTEND_URL'),
      'http://localhost:8081',
      'https://kue-prototype.vercel.app',
      'https://kue-platform.vercel.app',
    ].filter((origin) => !!origin),
    credentials: true,
  });

  // Register cookie support for session management
  await app.register(require('@fastify/cookie') as any);

  // Register multipart for file uploads (LinkedIn CSV import)
  await app.register(
    require('@fastify/multipart') as any,
    { limits: { fileSize: 10 * 1024 * 1024 } }, // 10MB max
  );

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Kue API')
    .setDescription('Professional network intelligence platform API')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  // Make the NestJS app instance available to Inngest functions
  setAppInstance(app);

  const port = configService.get<number>('PORT', 3000);
  await app.listen(port, '0.0.0.0');
  console.log(`Kue API running on http://localhost:${port}`);
  console.log(`Swagger docs at http://localhost:${port}/api/docs`);
}
bootstrap();
