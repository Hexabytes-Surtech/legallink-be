import { ApiProperty } from '@nestjs/swagger';

export class UpdateUserProfileDto {
  @ApiProperty({
    description: 'Phone number (optional update)',
    example: '+919876543210',
    required: false,
  })
  phone?: string;

  @ApiProperty({
    description: 'Preferred language (optional update)',
    example: 'en',
    required: false,
  })
  preferred_language?: string;
}
