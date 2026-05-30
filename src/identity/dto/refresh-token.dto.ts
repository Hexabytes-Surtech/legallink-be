import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({
    description:
      'The refresh token issued at login. Optional in body — normally read from the httpOnly refreshToken cookie.',
    example: 'eyJhbGciOiJIUzI1NiIs...',
    required: false,
  })
  @IsOptional()
  @IsString()
  refreshToken?: string;
}
