import { ApiProperty } from '@nestjs/swagger';

export class UpdateConsultationDto {
  @ApiProperty({
    description: 'Accept or decline the consultation request',
    enum: ['accept', 'decline'],
    example: 'accept',
  })
  action: 'accept' | 'decline';

  @ApiProperty({
    description: 'Reason for declining (required when action = decline)',
    example: 'I do not handle traffic cases in Howrah.',
    required: false,
  })
  declineReason?: string;
}
