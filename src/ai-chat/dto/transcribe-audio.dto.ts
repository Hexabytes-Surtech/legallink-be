import { IsString, IsIn, IsOptional, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TranscribeAudioDto {
  @ApiProperty({ description: 'Base64-encoded 16 kHz mono WAV audio' })
  @IsString()
  @MinLength(1)
  audio: string;

  @ApiPropertyOptional({ enum: ['en', 'bn'], default: 'en' })
  @IsOptional()
  @IsIn(['en', 'bn'])
  lang?: 'en' | 'bn';
}
