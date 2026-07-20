import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ConsultationActionDto {
  @ApiProperty({ enum: ['accept', 'decline'] })
  @IsIn(['accept', 'decline'])
  action: 'accept' | 'decline';

  @ApiProperty({ required: false, example: 'Schedule conflict' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  declineReason?: string;
}