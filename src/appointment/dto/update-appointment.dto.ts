import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional } from 'class-validator';

export class UpdateAppointmentDto {
  @ApiProperty({ enum: ['cancel', 'reschedule'] })
  @IsIn(['cancel', 'reschedule'])
  action: 'cancel' | 'reschedule';

  @ApiProperty({
    example: '2026-06-15T10:00:00.000Z',
    required: false,
    description: 'Required when action=reschedule',
  })
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;
}
