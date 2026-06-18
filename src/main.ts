import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  // rawBody:true exposes req.rawBody (Buffer) so the Razorpay webhook can verify its
  // HMAC signature over the exact bytes Razorpay signed.
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // Global error envelope (E-6) — mirrors the success envelope so the FE has one contract.
  app.useGlobalFilters(new AllExceptionsFilter());

  // Global request validation (Group A / H-1).
  // whitelist: strip any property not declared (with a class-validator decorator) on the DTO.
  // forbidNonWhitelisted: false (Lenient) — unknown props are dropped silently, NOT rejected.
  //   Flip to true once frontend payloads are audited (see VALIDATION_TRACKING.md).
  // transform + enableImplicitConversion: coerce primitives (e.g. query "?page=2" string → number).
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

    const corsOrigins = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Parse cookies — refresh token is read from req.cookies.refreshToken
  app.use(cookieParser());

  // All routes are prefixed with /api  (e.g. /api/auth/register)
  app.setGlobalPrefix('api');

  const config = new DocumentBuilder()
    .setTitle('LegalLink API')
    .setDescription('The LegalLink API documentation')
    .setVersion('1.0')
    .addBearerAuth() // enables the Authorize button in Swagger UI for JWT
    .build();
  const documentFactory = () => SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api-docs', app, documentFactory);

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
