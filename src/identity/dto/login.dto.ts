import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({
    description: 'The email address of the registered user',
    example: 'advocate@example.com',
  })
  email: string;
}
