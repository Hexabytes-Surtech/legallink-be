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
import { AdvocateService } from './advocate.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import { UpdateProfileDto } from './dto/update-profile.dto';

@ApiTags('Advocate')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('advocate')
@Controller('advocate')
export class AdvocateController {
  constructor(private readonly advocateService: AdvocateService) {}

  // ── GET /api/advocate/me ──────────────────────────────────────────────
  @Get('me')
  @ApiOperation({ summary: 'Get current advocate profile' })
  @ApiResponse({
    status: 200,
    description:
      'Returns merged advocate + user fields including verification_status',
  })
  @ApiResponse({ status: 404, description: 'ADVOCATE_PROFILE_NOT_FOUND' })
  getMe(@CurrentUser() user: JwtPayload) {
    return this.advocateService.getMe(user.sub);
  }

  // ── API 7 — Update advocate profile ──────────────────────────────────────
  @Put('profile')
  @ApiOperation({
    summary: 'Update advocate professional profile (partial updates)',
  })
  @ApiBody({ type: UpdateProfileDto })
  @ApiResponse({
    status: 200,
    description: 'Profile updated; returns merged advocate + user data',
  })
  @ApiResponse({ status: 404, description: 'Advocate profile not found' })
  updateProfile(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.advocateService.updateProfile(user.sub, dto);
  }

  // ── GET /api/advocate/documents ────────────────────────────────────────
  @Get('documents')
  @ApiOperation({ summary: 'List uploaded verification documents' })
  @ApiResponse({
    status: 200,
    description: 'Returns array of document objects',
  })
  getDocuments(@CurrentUser() user: JwtPayload) {
    return this.advocateService.getDocuments(user.sub);
  }

  // ── API 8 — Upload verification documents ────────────────────────────────
  @Post('documents')
  @UseInterceptors(FileInterceptor('document'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload Certificate of Practice or verification documents',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { document: { type: 'string', format: 'binary' } },
    },
  })
  @ApiResponse({
    status: 201,
    description:
      'Document uploaded; returns documentId, file_path, file_type, uploaded_at',
  })
  uploadDocument(
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.advocateService.uploadDocument(user.sub, file);
  }
}
