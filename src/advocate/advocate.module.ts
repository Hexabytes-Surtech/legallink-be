import { Module } from '@nestjs/common';
import { AdvocateController } from './advocate.controller';
import { AdvocatePublicController } from './advocate-public.controller';
import { AdvocateService } from './advocate.service';
import { DatabaseModule } from '../database/database.module';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';

@Module({
  imports: [DatabaseModule, CloudinaryModule],
  controllers: [AdvocateController, AdvocatePublicController],
  providers: [AdvocateService],
})
export class AdvocateModule {}
