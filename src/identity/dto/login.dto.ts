import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';

export class LoginDto {
  @ApiProperty({
    description: 'The email address of the registered user',
    example: 'advocate@example.com',
  })
  @IsEmail()
  email: string;
}
