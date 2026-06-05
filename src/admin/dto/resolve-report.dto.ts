import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ResolveReportDto {
  @ApiProperty({
    enum: ['review', 'dismiss'],
    description: 'Admin decision: review = action taken, dismiss = no action needed',
    example: 'review',
  })
  @IsIn(['review', 'dismiss'])
  action: 'review' | 'dismiss';

  @ApiProperty({
    description: 'Internal admin note on the resolution (optional)',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
