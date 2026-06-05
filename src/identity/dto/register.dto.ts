import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn } from 'class-validator';

export class RegisterDto {
  @ApiProperty({
    description: 'The email address to register',
    example: 'advocate@example.com',
  })
  @IsEmail()
  email: string;

  @ApiProperty({
    description: 'User role — citizen or advocate (admin cannot self-register)',
    enum: ['citizen', 'advocate'],
    example: 'advocate',
  })
  @IsIn(['citizen', 'advocate'])
  role: 'citizen' | 'advocate';
}
