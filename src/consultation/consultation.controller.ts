import {
  Controller,
  Post,
  Get,
  Put,
  Body,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ConsultationService } from './consultation.service';
import { CreateConsultationDto } from './dto/create-consultation.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../common/decorators/current-user.decorator';

@ApiTags('Consultation')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('consultations')
export class ConsultationController {
  constructor(private readonly consultationService: ConsultationService) {}

  // BUG-5: Restricted to citizen role only
  @Post()
  @UseGuards(RolesGuard)
  @Roles('citizen')
  @ApiOperation({ summary: 'Citizen requests a consultation with an advocate' })
  @ApiResponse({ status: 201, description: 'Consultation request created' })
  @ApiResponse({ status: 404, description: 'Matter or advocate not found' })
  @ApiResponse({ status: 409, description: 'Consultation already exists' })
  requestConsultation(
    @Body() dto: CreateConsultationDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.consultationService.requestConsultation(dto, user.sub);
  }

  // Must be declared before :id to avoid route conflict
  @Get('unread-count')
  @UseGuards(RolesGuard)
  @Roles('citizen')
  @ApiOperation({ summary: 'Unread badge count for citizen chat icon' })
  @ApiResponse({ status: 200, description: '{ count: number }' })
  getUnreadCount(@CurrentUser() user: JwtPayload) {
    return this.consultationService.getUnreadCount(user.sub);
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles('citizen')
  @ApiOperation({ summary: "List citizen's own consultations" })
  @ApiResponse({ status: 200, description: 'Array of consultations' })
  listMine(@CurrentUser() user: JwtPayload) {
    return this.consultationService.listMyCitizenConsultations(user.sub);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get single consultation (citizen or advocate)' })
  @ApiResponse({ status: 200, description: 'Consultation detail' })
  @ApiResponse({ status: 404, description: 'Not found or no access' })
  getOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.consultationService.getConsultation(id, user.sub);
  }

  @Put(':id/close')
  @UseGuards(RolesGuard)
  @Roles('citizen')
  @ApiOperation({ summary: 'Citizen closes an accepted consultation' })
  @ApiResponse({ status: 200, description: 'Consultation closed' })
  @ApiResponse({ status: 400, description: 'Not in accepted state' })
  @ApiResponse({ status: 404, description: 'Not found or not yours' })
  closeConsultation(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.consultationService.closeConsultation(id, user.sub);
  }
}
