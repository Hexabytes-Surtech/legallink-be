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
import { ReportCitizenDto } from './dto/report-citizen.dto';
import { UpdateStageDto } from './dto/update-stage.dto';
import { CloseConsultationDto } from './dto/close-consultation.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import { AnonymousSessionId } from '../common/session/anonymous-session.decorator';

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
    @AnonymousSessionId() sessionId?: string,
  ) {
    return this.consultationService.requestConsultation(dto, user.sub, sessionId ?? null);
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

  // Case timeline — readable by both participants (citizen views read-only on the FE).
  @Get(':id/timeline')
  @ApiOperation({ summary: 'Get the case timeline (stages + closure) for a consultation' })
  @ApiResponse({ status: 200, description: 'Current stage, dated events, and closure detail' })
  @ApiResponse({ status: 404, description: 'Not found or no access' })
  getTimeline(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.consultationService.getTimeline(id, user.sub);
  }

  // Advocate-only: advance (or correct) the case stage on an accepted consultation.
  @Put(':id/stage')
  @UseGuards(RolesGuard)
  @Roles('advocate')
  @ApiOperation({ summary: 'Advocate updates the case stage (advocate-only)' })
  @ApiResponse({ status: 200, description: 'Stage updated; returns the new event' })
  @ApiResponse({ status: 400, description: 'Invalid stage or not in accepted state' })
  @ApiResponse({ status: 404, description: 'Not found or not the advocate on it' })
  updateStage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStageDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.consultationService.updateStage(id, user.sub, dto);
  }

  // Either party may end an accepted consultation. A CITIZEN close is their absolute
  // right to withdraw (forced outcome 'withdrawn_by_client'). An ADVOCATE close issues
  // the Consultation Closure Summary (requires an outcome + a written summary).
  @Put(':id/close')
  @UseGuards(RolesGuard)
  @Roles('citizen', 'advocate')
  @ApiOperation({ summary: 'End an accepted consultation (citizen withdrawal or advocate closure summary)' })
  @ApiResponse({ status: 200, description: 'Consultation closed' })
  @ApiResponse({ status: 400, description: 'Not in accepted state, or advocate close missing outcome/summary' })
  @ApiResponse({ status: 404, description: 'Not found or not a participant' })
  closeConsultation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CloseConsultationDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.consultationService.closeConsultation(id, user.sub, user.role, dto);
  }

  // Advocate-only: report the citizen on a closed consultation (one per consultation).
  @Post(':id/report')
  @UseGuards(RolesGuard)
  @Roles('advocate')
  @ApiOperation({ summary: 'Advocate reports the citizen on a closed consultation' })
  @ApiResponse({ status: 201, description: 'Report filed' })
  @ApiResponse({ status: 400, description: 'Consultation not closed' })
  @ApiResponse({ status: 404, description: 'Not found or not the advocate on it' })
  @ApiResponse({ status: 409, description: 'Already reported' })
  reportCitizen(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReportCitizenDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.consultationService.reportCitizen(id, user.sub, dto);
  }
}
