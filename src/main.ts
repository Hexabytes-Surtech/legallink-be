import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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
