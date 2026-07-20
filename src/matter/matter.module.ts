import { Module } from '@nestjs/common';
import { MatterController } from './matter.controller';
import { MatterService } from './matter.service';
import { DatabaseModule } from '../database/database.module';
import { AiModule } from '../ai/ai.module';
import { MatchingModule } from '../matching/matching.module';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';

@Module({
  imports: [DatabaseModule, AiModule, MatchingModule, CloudinaryModule],
  controllers: [MatterController],
  providers: [MatterService],
  exports: [MatterService],
})
export class MatterModule {}
