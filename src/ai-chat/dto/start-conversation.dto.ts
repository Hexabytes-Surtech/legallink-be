import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class StartConversationDto {
  @ApiProperty({ enum: ['en', 'bn'], description: "The citizen's chat language" })
  @IsString()
  @IsIn(['en', 'bn'])
  language: 'en' | 'bn';

  @ApiPropertyOptional({
    description: 'Optional first message — if provided, the AI replies immediately to it',
    maxLength: 4000,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  message?: string;
}
