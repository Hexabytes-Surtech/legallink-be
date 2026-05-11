import { ApiProperty } from '@nestjs/swagger';

export class RequestOtpDto {
  @ApiProperty({
    description: 'The email address to send the OTP to',
    example: 'advocate@example.com',
  })
  email: string;
}
