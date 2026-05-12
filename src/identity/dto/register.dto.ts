import { ApiProperty } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({
    description: 'The email address to register',
    example: 'advocate@example.com',
  })
  email: string;

  @ApiProperty({
    description: 'User role — citizen or advocate (admin cannot self-register)',
    enum: ['citizen', 'advocate'],
    example: 'advocate',
  })
  role: 'citizen' | 'advocate';

  @ApiProperty({
    description: 'Preferred language (optional, defaults to en)',
    example: 'en',
    required: false,
  })
  preferred_language?: string;
}
