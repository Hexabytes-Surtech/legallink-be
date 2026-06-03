import {
  Controller,
  Post,
  Delete,
  Param,
  ParseUUIDPipe,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Express } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { ConversationService } from './conversation.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../common/decorators/current-user.decorator';

@ApiTags('Conversation')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('consultations')
export class ConversationController {
  constructor(private readonly service: ConversationService) {}

  // ── Citizen attaches an image/PDF to a live consultation ──────────────────
  @Post(':id/attachments')
  @UseGuards(RolesGuard)
  @Roles('citizen')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Citizen attaches an image or PDF to a consultation chat' })
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiResponse({ status: 201, description: 'Attachment uploaded and broadcast to the chat' })
  @ApiResponse({ status: 400, description: 'UNSUPPORTED_FILE_TYPE | FILE_TOO_LARGE | CONSULTATION_NOT_ACTIVE' })
  uploadAttachment(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.uploadAttachment(id, user.sub, file);
  }

  // ── Citizen deletes one of their own attachments ──────────────────────────
  @Delete(':id/attachments/:messageId')
  @UseGuards(RolesGuard)
  @Roles('citizen')
  @ApiOperation({ summary: "Citizen removes one of their own chat attachments" })
  @ApiResponse({ status: 200, description: 'Attachment removed' })
  @ApiResponse({ status: 403, description: 'NOT_YOUR_MESSAGE | NOT_YOUR_CONSULTATION' })
  deleteAttachment(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.deleteAttachment(id, user.sub, messageId);
  }
}
