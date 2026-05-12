import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
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
      properties: { avatar: { type: 'string', format: 'binary' } },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Avatar uploaded; returns { avatar_url }',
  })
  uploadAvatar(
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.userService.uploadAvatar(user.sub, file);
  }
}
