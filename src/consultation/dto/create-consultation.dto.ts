import { ApiProperty } from '@nestjs/swagger';

export class CreateConsultationDto {
  @ApiProperty({ example: 'b5c3d765-a9de-43f6-9457-fbb326b649a5' })
  matterId: string;

  @ApiProperty({ example: '257bc413-f74c-4690-b8a5-804e5af9df13' })
  advocateId: string;

  @ApiProperty({ example: 'I need help urgently with my eviction case.', required: false })
  citizenNote?: string;
}
