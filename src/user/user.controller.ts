import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { UserService } from './user.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import { UpdateUserProfileDto } from './dto/update-user-profile.dto';

@ApiTags('User')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  // ── GET /api/user/me ──────────────────────────────────────────────────
  @Get('me')
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({
    status: 200,
    description: 'Returns user object without sensitive fields',
  })
  getMe(@CurrentUser() user: JwtPayload) {
    return this.userService.getMe(user.sub);
  }

  // ── API 5 — Update user profile ─────────────────────────────────────────
  @Put('profile')
  @ApiOperation({ summary: 'Update user profile (phone, preferred_language)' })
  @ApiBody({ type: UpdateUserProfileDto })
  @ApiResponse({
    status: 200,
    description:
      'Profile updated; returns user object without sensitive fields',
  })
  updateProfile(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateUserProfileDto,
  ) {
    return this.userService.updateProfile(user.sub, dto);
  }

  // ── API 6 — Upload avatar ──────────────────────────────────────────────
  @Post('avatar')
  @UseInterceptors(FileInterceptor('avatar'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload avatar image (Cloudinary)' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        avatar: { type: 'string', format: 'binary' },
        cropX: { type: 'number' },
        cropY: { type: 'number' },
        cropWidth: { type: 'number' },
        cropHeight: { type: 'number' },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Avatar uploaded; returns { avatar_url }',
  })
  uploadAvatar(
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { cropX?: string; cropY?: string; cropWidth?: string; cropHeight?: string },
  ) {
    if (!file) throw new BadRequestException('No avatar file provided');

    // Crop rect arrives as multipart text fields alongside the file. Only honour it
    // when all four are present and valid; otherwise store the full image.
    const num = (v?: string) =>
      v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined;
    const x = num(body?.cropX);
    const y = num(body?.cropY);
    const width = num(body?.cropWidth);
    const height = num(body?.cropHeight);
    const crop =
      x !== undefined && y !== undefined && width !== undefined && height !== undefined && width > 0 && height > 0
        ? { x, y, width, height }
        : undefined;

    return this.userService.uploadAvatar(user.sub, file, crop);
  }
}
