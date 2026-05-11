import { ApiProperty } from '@nestjs/swagger';

export class UpdateAvailabilityDto {
  @ApiProperty({ description: 'Whether the advocate is currently available', example: true })
  available: boolean;
}
