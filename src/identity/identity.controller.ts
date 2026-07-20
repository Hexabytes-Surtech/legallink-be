import {
  Controller,
  Post,
  Body,
  HttpCode,
  UseGuards,
  Res,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiBearerAuth,
} from '@nestjs/swagger';
import type { Response, Request } from 'express';
import { IdentityService } from './identity.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../common/decorators/current-user.decorator';

@ApiTags('Auth')
@Controller('auth')
export class IdentityController {
  constructor(private readonly identityService: IdentityService) {}

  // ── API 1 — Register ────────────────────────────────────────────────────
  @Post('register')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Register a new user (citizen or advocate) and send OTP',
  })
  @ApiBody({ type: RegisterDto })
  @ApiResponse({ status: 202, description: 'OTP sent to the provided email' })
  @ApiResponse({ status: 400, description: 'Invalid role or email' })
  @ApiResponse({
    status: 409,
    description: 'Email already registered and verified',
  })
  register(@Body() dto: RegisterDto) {
    return this.identityService.register(dto.email, dto.role);
  }

  // ── Login ───────────────────────────────────────────────────────────────
  @Post('login')
  @HttpCode(202)
  @ApiOperation({ summary: 'Login with email — sends OTP to verified user' })
  @ApiBody({ type: LoginDto })
  @ApiResponse({ status: 202, description: 'OTP sent to the provided email' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({ status: 403, description: 'Email not verified' })
  login(@Body() dto: LoginDto) {
    return this.identityService.login(dto.email);
  }

  // ── API 2 — Verify OTP ─────────────────────────────────────────────────
  @Post('verify-otp')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Verify OTP and receive access token + refresh cookie',
  })
  @ApiBody({ type: VerifyOtpDto })
  @ApiResponse({
    status: 200,
    description:
      'OTP verified; access token returned, refresh token set as cookie',
  })
  @ApiResponse({ status: 401, description: 'Invalid or expired OTP' })
  async verifyOtp(
    @Body() dto: VerifyOtpDto,
    @Res({ passthrough: true }) res: Response,
    @Req() req: Request,
  ) {
    return this.identityService.verifyOtp(dto.email, dto.otp, res, req);
  }

  // ── API 3 — Logout ─────────────────────────────────────────────────────
  @Post('logout')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout — clears refresh token and cookie' })
  @ApiResponse({ status: 200, description: 'Logged out successfully' })
  async logout(
    @CurrentUser() user: JwtPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.identityService.logout(user.sub, res);
  }

  // ── API 4 — Refresh Token ──────────────────────────────────────────────
  @Post('refresh-token')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Get a new access token using the refresh token cookie',
  })
  @ApiResponse({ status: 200, description: 'New access token issued' })
  @ApiResponse({ status: 401, description: 'Invalid or expired refresh token' })
  refreshToken(@Req() req: Request) {
    return this.identityService.refreshAccessToken(req);
  }
}
