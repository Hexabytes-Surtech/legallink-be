import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { AppController } from './app.controller';
import { AppService } from './app.service';

import { DatabaseModule } from './database/database.module';
import { CloudinaryModule } from './cloudinary/cloudinary.module';
import { IdentityModule } from './identity/identity.module';
import { AdvocateModule } from './advocate/advocate.module';
import { AdminModule } from './admin/admin.module';

import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: `.env.${process.env.NODE_ENV}`,
    }),
    DatabaseModule,
    CloudinaryModule,
    IdentityModule,
    AdvocateModule,
    AdminModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Applies { success, data, meta } envelope to ALL responses globally
    {
      provide: APP_INTERCEPTOR,
      useClass: ResponseEnvelopeInterceptor,
    },
  ],
})
export class AppModule {}