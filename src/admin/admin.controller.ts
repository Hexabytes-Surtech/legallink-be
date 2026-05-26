import { Controller, Get, Put, Param, Body, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { VerifyAdvocateDto } from './dto/verify-advocate.dto';
import { UpdateMessageDto } from './dto/update-message.dto';

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // ── Advocate verification ──────────────────────────────────────────────────

  @Get('advocates/pending')
  @ApiOperation({ summary: 'List all advocates with pending verification (admin only)' })
  @ApiResponse({ status: 200, description: 'Pending advocates returned with their documents' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  getPendingAdvocates() {
    return this.adminService.getPendingAdvocates();
  }

  @Put('advocates/:advocateId/verify')
  @ApiOperation({ summary: 'Approve or reject an advocate (admin only)' })
  @ApiParam({ name: 'advocateId', description: 'Advocate UUID' })
  @ApiBody({ type: VerifyAdvocateDto })
  @ApiResponse({ status: 200, description: 'Verification status updated' })
  @ApiResponse({ status: 404, description: 'Advocate not found' })
  verifyAdvocate(
    @Param('advocateId') advocateId: string,
    @Body() dto: VerifyAdvocateDto,
  ) {
    return this.adminService.verifyAdvocate(advocateId, dto.action, dto.reason);
  }

  // ── Message moderation ─────────────────────────────────────────────────────

  @Get('messages/flagged')
  @ApiOperation({ summary: 'List all flagged messages awaiting admin review (admin only)' })
  @ApiResponse({ status: 200, description: 'Flagged messages returned' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  getFlaggedMessages() {
    return this.adminService.getFlaggedMessages();
  }

  @Put('messages/:messageId')
  @ApiOperation({ summary: 'Approve or dismiss a flagged message (admin only)' })
  @ApiParam({ name: 'messageId', description: 'Message UUID' })
  @ApiBody({ type: UpdateMessageDto })
  @ApiResponse({ status: 200, description: 'Message moderation status updated' })
  @ApiResponse({ status: 404, description: 'Message not found' })
  updateMessageStatus(
    @Param('messageId') messageId: string,
    @Body() dto: UpdateMessageDto,
  ) {
    return this.adminService.updateMessageStatus(messageId, dto.action);
  }
}
