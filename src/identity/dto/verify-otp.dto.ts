import { ApiProperty } from '@nestjs/swagger';

export class VerifyOtpDto {
  @ApiProperty({
    description: 'The email address the OTP was sent to',
    example: 'advocate@example.com',
  })
  email: string;

  @ApiProperty({
    description: '6-digit OTP received in email',
    example: '482910',
  })
  otp: string;
}
