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

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('admin/advocates')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('pending')
  @ApiOperation({
    summary: 'List all advocates with pending verification (admin only)',
  })
  @ApiResponse({
    status: 200,
    description: 'Pending advocates returned with their documents',
  })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  getPendingAdvocates() {
    return this.adminService.getPendingAdvocates();
  }

  @Put(':advocateId/verify')
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
}
