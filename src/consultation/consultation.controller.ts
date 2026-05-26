import { Controller, Post, Get, Body, Param, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ConsultationService } from './consultation.service';
import { CreateConsultationDto } from './dto/create-consultation.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Consultation')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('consultations')
export class ConsultationController {
  constructor(private readonly consultationService: ConsultationService) {}

  @Post()
  @ApiOperation({ summary: 'Citizen requests a consultation with an advocate' })
  @ApiResponse({ status: 201, description: 'Consultation request created' })
  @ApiResponse({ status: 404, description: 'Matter or advocate not found' })
  @ApiResponse({ status: 409, description: 'Consultation already exists' })
  requestConsultation(
    @Body() dto: CreateConsultationDto,
    @CurrentUser() user: any,
  ) {
    return this.consultationService.requestConsultation(dto, user.sub);
  }

  @Get()
  @ApiOperation({ summary: 'List citizen\'s own consultations' })
  @ApiResponse({ status: 200, description: 'Array of consultations' })
  listMine(@CurrentUser() user: any) {
    return this.consultationService.listMyCitizenConsultations(user.sub);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get single consultation (citizen or advocate)' })
  @ApiResponse({ status: 200, description: 'Consultation detail' })
  @ApiResponse({ status: 404, description: 'Not found or no access' })
  getOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.consultationService.getConsultation(id, user.sub);
  }
}
