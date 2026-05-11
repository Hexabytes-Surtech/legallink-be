import { Module } from '@nestjs/common';
import { AdvocateController } from './advocate.controller';
import { ConsultationController } from './consultation.controller';
import { AdvocateService } from './advocate.service';
import { DatabaseModule } from '../database/database.module';
import { IdentityModule } from '../identity/identity.module';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';

@Module({
  imports: [DatabaseModule, IdentityModule, CloudinaryModule],
  controllers: [AdvocateController, ConsultationController],
  providers: [AdvocateService],
  exports: [AdvocateService],
})
export class AdvocateModule {}
