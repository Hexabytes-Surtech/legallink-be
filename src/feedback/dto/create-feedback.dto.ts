import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateFeedbackDto {
  @ApiProperty({ minimum: 1, maximum: 5, description: 'Star rating 1–5' })
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @ApiPropertyOptional({ maxLength: 500, description: 'Optional comment (max 500 chars)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}
