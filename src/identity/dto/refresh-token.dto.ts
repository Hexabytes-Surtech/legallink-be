import { ApiProperty } from '@nestjs/swagger';

export class RefreshTokenDto {
  @ApiProperty({
    description: 'The refresh token issued at login',
    example: 'eyJhbGciOiJIUzI1NiIs...',
  })
  refreshToken: string;
}
