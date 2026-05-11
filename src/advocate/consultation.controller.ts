import { Controller, Put, Param, Body, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import { AdvocateService } from '../advocate/advocate.service';
import { UpdateConsultationDto } from '../advocate/dto/update-consultation.dto';

// This controller exposes PUT /consultations/:id at the global level
// (as required by the API contract), reusing the same service method from AdvocateService.
@ApiTags('Consultations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('consultations')
export class ConsultationController {
  constructor(private readonly advocateService: AdvocateService) {}

  @Put(':id')
  @Roles('advocate')
  @ApiOperation({ summary: '(Shared) Accept or decline a consultation — used by citizen frontend polling' })
  @ApiParam({ name: 'id', description: 'Consultation UUID' })
  @ApiBody({ type: UpdateConsultationDto })
  @ApiResponse({ status: 200, description: 'Consultation status updated' })
  updateConsultation(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateConsultationDto,
  ) {
    return this.advocateService.updateConsultation(user.sub, id, dto);
  }
}
