import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  UseGuards,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Express } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { MatterService } from './matter.service';
import { CreateMatterDto } from './dto/create-matter.dto';
import { OptionalJwtGuard } from '../common/guards/optional-jwt.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AnonymousSessionId } from '../common/session/anonymous-session.decorator';

@ApiTags('Matter')
@Controller('matter')
export class MatterController {
  constructor(private readonly matterService: MatterService) {}

  // ── POST /api/matter  (anonymous or authenticated) ───────────────────────
  @Post()
  @UseGuards(OptionalJwtGuard)
  @ApiOperation({ summary: 'Submit a legal query — creates a matter with AI response' })
  @ApiResponse({ status: 201, description: 'Matter created with AI response and advocate matches' })
  @ApiResponse({ status: 400, description: 'QUERY_REQUIRED | QUERY_TOO_LONG | LANGUAGE_UNSUPPORTED' })
  async createMatter(
    @Body() dto: CreateMatterDto,
    @CurrentUser() user?: any,
    @AnonymousSessionId() sessionId?: string,
  ) {
    return this.matterService.createMatter(dto, user?.sub ?? null, sessionId ?? null);
  }

  // ── GET /api/matter  (list for authenticated citizen) ────────────────────
  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List matters owned by the authenticated citizen' })
  @ApiResponse({ status: 200, description: 'Array of the citizen\'s matters (newest first)' })
  async listMatters(@CurrentUser() user: any) {
    return this.matterService.listMattersForCitizen(user.sub);
  }

  // ── GET /api/matter/:id ──────────────────────────────────────────────────
  @Get(':id')
  @UseGuards(OptionalJwtGuard)
  @ApiOperation({ summary: 'Get matter details with AI response and citations' })
  @ApiResponse({ status: 200, description: 'Matter detail' })
  @ApiResponse({ status: 404, description: 'MATTER_NOT_FOUND' })
  async getMatter(
    @Param('id') id: string,
    @CurrentUser() user?: any,
    @AnonymousSessionId() sessionId?: string,
  ) {
    return this.matterService.getMatterById(id, user?.sub ?? null, sessionId ?? null);
  }

  // ── POST /api/matter/:id/documents ────────────────────────────────────────
  @Post(':id/documents')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a document (image or PDF) to a matter via Cloudinary' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @ApiResponse({ status: 201, description: 'Document uploaded' })
  @ApiResponse({ status: 400, description: 'FILE_REQUIRED | FILE_TOO_LARGE | UNSUPPORTED_FILE_TYPE' })
  @ApiResponse({ status: 404, description: 'MATTER_NOT_FOUND' })
  async uploadDocument(
    @Param('id') matterId: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: any,
  ) {
    if (!file) throw new BadRequestException('FILE_REQUIRED');
    return this.matterService.uploadDocumentForMatter(matterId, file, user.sub);
  }

  // ── GET /api/matter/:id/advocates ─────────────────────────────────────────
  @Get(':id/advocates')
  @UseGuards(OptionalJwtGuard)
  @ApiOperation({ summary: 'Get verified advocates matching this matter' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 5 })
  @ApiResponse({ status: 200, description: 'Paginated advocate matches' })
  async getAdvocates(
    @Param('id') id: string,
    @Query('page') page = '1',
    @Query('limit') limit = '5',
    @CurrentUser() user?: any,
    @AnonymousSessionId() sessionId?: string,
  ) {
    return this.matterService.getMatchingAdvocates(
      id,
      user?.sub ?? null,
      Number(page),
      Number(limit),
      sessionId ?? null,
    );
  }
}
