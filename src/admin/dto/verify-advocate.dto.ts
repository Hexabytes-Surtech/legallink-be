import { ApiProperty } from '@nestjs/swagger';

export class VerifyAdvocateDto {
  @ApiProperty({
    enum: ['approve', 'reject'],
    description: 'Admin decision on advocate verification',
    example: 'approve',
  })
  action: 'approve' | 'reject';

  @ApiProperty({
    description: 'Reason for rejection (required when action = reject)',
    example: 'Bar enrolment number could not be verified.',
    required: false,
  })
  reason?: string;
}
