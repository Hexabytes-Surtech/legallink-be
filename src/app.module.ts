import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { SessionMiddleware } from './common/session/session.middleware';

import { AppController } from './app.controller';
import { AppService } from './app.service';

import { DatabaseModule } from './database/database.module';
import { CloudinaryModule } from './cloudinary/cloudinary.module';
import { IdentityModule } from './identity/identity.module';
import { UserModule } from './user/user.module';
import { AdvocateModule } from './advocate/advocate.module';
import { AdminModule } from './admin/admin.module';
import { AiModule } from './ai/ai.module';
import { AiChatModule } from './ai-chat/ai-chat.module';
import { MatchingModule } from './matching/matching.module';
import { MatterModule } from './matter/matter.module';
import { ConsultationModule } from './consultation/consultation.module';
import { ConversationModule } from './conversation/conversation.module';
import { CallModule } from './call/call.module';
import { PushModule } from './push/push.module';
import { ModerationModule } from './moderation/moderation.module';
import { EmailModule } from './email/email.module';
import { CleanupModule } from './cleanup/cleanup.module';
import { AvailabilityModule } from './availability/availability.module';
import { AppointmentModule } from './appointment/appointment.module';
import { FeedbackModule } from './feedback/feedback.module';
import { BillingModule } from './billing/billing.module';

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
    UserModule,
    AdvocateModule,
    AdminModule,
    AiModule,
    AiChatModule,
    MatchingModule,
    MatterModule,
    ConsultationModule,
    ConversationModule,
    CallModule,
    PushModule,
    ModerationModule,
    EmailModule,
    CleanupModule,
    AvailabilityModule,
    AppointmentModule,
    FeedbackModule,
    BillingModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_INTERCEPTOR,
      useClass: ResponseEnvelopeInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(SessionMiddleware).forRoutes('*');
  }
}
