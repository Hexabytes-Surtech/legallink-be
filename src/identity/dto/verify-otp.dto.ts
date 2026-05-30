import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length } from 'class-validator';

export class VerifyOtpDto {
  @ApiProperty({
    description: 'The email address the OTP was sent to',
    example: 'advocate@example.com',
  })
  @IsEmail()
  email: string;

  @ApiProperty({
    description: '6-digit OTP received in email',
    example: '482910',
  })
  @IsString()
  @Length(6, 6)
  otp: string;
}
