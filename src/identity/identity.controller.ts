import { Controller, Post, Body, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { IdentityService } from './identity.service';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

@ApiTags('Auth')
@Controller('auth')
export class IdentityController {
  constructor(private readonly identityService: IdentityService) {}

  @Post('request-otp')
  @HttpCode(202)
  @ApiOperation({ summary: 'Send a 6-digit OTP to the provided email address' })
  @ApiBody({ type: RequestOtpDto })
  @ApiResponse({ status: 202, description: 'OTP sent successfully' })
  @ApiResponse({ status: 400, description: 'Invalid email' })
  requestOtp(@Body() dto: RequestOtpDto) {
    return this.identityService.requestOtp(dto.email);
  }

  @Post('verify-otp')
  @HttpCode(200)
  @ApiOperation({ summary: 'Verify OTP and receive access + refresh JWT tokens' })
  @ApiBody({ type: VerifyOtpDto })
  @ApiResponse({ status: 200, description: 'OTP verified; tokens returned' })
  @ApiResponse({ status: 401, description: 'Invalid or expired OTP' })
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.identityService.verifyOtp(dto.email, dto.otp);
  }

  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Use a refresh token to get a new access token' })
  @ApiBody({ type: RefreshTokenDto })
  @ApiResponse({ status: 200, description: 'New access token issued' })
  @ApiResponse({ status: 401, description: 'Invalid or expired refresh token' })
  refresh(@Body() dto: RefreshTokenDto) {
    return this.identityService.refreshAccessToken(dto.refreshToken);
  }
}
