import { ApiProperty } from '@nestjs/swagger';

export class ConsultationActionDto {
  @ApiProperty({ enum: ['accept', 'decline'] })
  action: 'accept' | 'decline';

  @ApiProperty({ required: false, example: 'Schedule conflict' })
  declineReason?: string;
}