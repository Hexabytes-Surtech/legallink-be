import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateConsultationDto {
  @ApiProperty({ example: 'b5c3d765-a9de-43f6-9457-fbb326b649a5' })
  @IsUUID()
  matterId: string;

  @ApiProperty({ example: '257bc413-f74c-4690-b8a5-804e5af9df13' })
  @IsUUID()
  advocateId: string;

  @ApiProperty({ example: 'I need help urgently with my eviction case.', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  citizenNote?: string;

  @ApiProperty({
    example: '2026-06-15T10:00:00.000Z',
    required: false,
    description: 'When provided, creates a consultation_appointment in the same transaction',
  })
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;
}
