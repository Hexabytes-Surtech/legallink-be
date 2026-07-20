import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

export class VerifyAdvocateDto {
  @ApiProperty({
    enum: ['approve', 'reject'],
    description: 'Admin decision on advocate verification',
    example: 'approve',
  })
  @IsIn(['approve', 'reject'])
  action: 'approve' | 'reject';

  @ApiProperty({
    description: 'Reason for rejection (required when action = reject)',
    example: 'Bar enrolment number could not be verified.',
    required: false,
  })
  @IsOptional()
  @IsString()
  reason?: string;
}
