import { Controller, Put, Param, Body, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AppointmentService } from './appointment.service';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../common/decorators/current-user.decorator';

@ApiTags('Appointments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('appointments')
export class AppointmentController {
  constructor(private readonly appointmentService: AppointmentService) {}

  @Put(':id')
  @ApiOperation({ summary: 'Reschedule or cancel an appointment (citizen or advocate)' })
  @ApiResponse({ status: 200, description: 'Appointment updated' })
  @ApiResponse({ status: 400, description: 'Invalid action or already cancelled/completed' })
  @ApiResponse({ status: 403, description: 'Not your appointment' })
  @ApiResponse({ status: 404, description: 'Appointment not found' })
  updateAppointment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAppointmentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.appointmentService.updateAppointment(id, user.sub, dto);
  }
}
