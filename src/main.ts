import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import * as bodyParser from 'body-parser';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  // bodyParser:false — we register our own parser below so we can set a 5 MB limit
  // (audio base64 payloads for the STT endpoint can be ~2 MB) while still capturing
  // req.rawBody for the Razorpay webhook HMAC check.
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  // Single JSON parser: 5 MB limit + rawBody capture for Razorpay.
  app.use(
    bodyParser.json({
      limit: '5mb',
      verify: (req: Request & { rawBody?: Buffer }, _res, buf: Buffer) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use(bodyParser.urlencoded({ extended: true, limit: '5mb' }));

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
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Anon-Session'],
  });

  // Parse cookies — refresh token is read from req.cookies.refreshToken
  app.use(cookieParser());

  // Request logger — method, path, status, duration. Gives the BE the same REQ-level
  // visibility the AI layer already has, so failures stop being invisible.
  // NOTE: SSE turns always FINISH 200 even when an in-band error event is sent — those
  // (AI_TURN_FAILED etc.) are logged inside AiChatService/AiChatController instead.
  const httpLogger = new Logger('HTTP');
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on('finish', () => {
      const ms = Date.now() - start;
      const line = `${req.method} ${req.originalUrl} -> ${res.statusCode} (${ms}ms)`;
      if (res.statusCode >= 500) httpLogger.error(line);
      else if (res.statusCode >= 400) httpLogger.warn(line);
      else httpLogger.log(line);
    });
    next();
  });

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

  await app.listen(process.env.PORT ?? 3000, process.env.HOST ?? '0.0.0.0');
}
bootstrap();
