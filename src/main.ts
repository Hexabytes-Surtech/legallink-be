import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // All routes are prefixed with /api  (e.g. /api/auth/request-otp)
  app.setGlobalPrefix('api/v1');

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
