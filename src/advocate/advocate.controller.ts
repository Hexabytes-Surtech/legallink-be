import {
  Controller,
  Post,
  Put,
  Get,
  Body,
  Param,
  Query,
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
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { AdvocateService } from './advocate.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import { RegisterAdvocateDto } from './dto/register-advocate.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateAvailabilityDto } from './dto/update-availability.dto';
import { UpdateConsultationDto } from './dto/update-consultation.dto';

@ApiTags('Advocate')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('advocate')
export class AdvocateController {
  constructor(private readonly advocateService: AdvocateService) {}

  // ── Group 2: Registration ─────────────────────────────────────────────────
  @Post('register')
  @ApiOperation({ summary: 'Register as an advocate after OTP verification' })
  @ApiBody({ type: RegisterAdvocateDto })
  @ApiResponse({ status: 201, description: 'Advocate registered; advocate JWT returned' })
  register(@CurrentUser() user: JwtPayload, @Body() dto: RegisterAdvocateDto) {
    return this.advocateService.register(user.sub, user.email, dto);
  }

  // ── Group 3: Profile & Onboarding ────────────────────────────────────────
  @Put('profile')
  @Roles('advocate')
  @ApiOperation({ summary: 'Update the 6-field BCI profile' })
  @ApiBody({ type: UpdateProfileDto })
  @ApiResponse({ status: 200, description: 'Profile updated' })
  updateProfile(@CurrentUser() user: JwtPayload, @Body() dto: UpdateProfileDto) {
    return this.advocateService.updateProfile(user.sub, dto);
  }

  @Post('documents')
  @Roles('advocate')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload Certificate of Practice or verification documents' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiResponse({ status: 201, description: 'Document uploaded; Cloudinary URL returned' })
  uploadDocument(
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.advocateService.uploadDocument(user.sub, file);
  }

  @Put('availability')
  @Roles('advocate')
  @ApiOperation({ summary: 'Toggle advocate availability' })
  @ApiBody({ type: UpdateAvailabilityDto })
  @ApiResponse({ status: 200, description: 'Availability updated' })
  updateAvailability(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateAvailabilityDto,
  ) {
    return this.advocateService.updateAvailability(user.sub, dto);
  }

  @Post('submit-verification')
  @Roles('advocate')
  @ApiOperation({ summary: 'Submit profile for admin verification review' })
  @ApiResponse({ status: 201, description: 'Submitted for verification' })
  submitVerification(@CurrentUser() user: JwtPayload) {
    return this.advocateService.submitVerification(user.sub);
  }

  // ── Group 4: Dashboard & Consultations ───────────────────────────────────
  @Get('dashboard')
  @Roles('advocate')
  @ApiOperation({ summary: 'Get advocate dashboard summary' })
  @ApiResponse({ status: 200, description: 'Dashboard data returned' })
  getDashboard(@CurrentUser() user: JwtPayload) {
    return this.advocateService.getDashboard(user.sub);
  }

  @Get('consultations')
  @Roles('advocate')
  @ApiOperation({ summary: 'List all incoming and active consultations' })
  @ApiResponse({ status: 200, description: 'Consultation list returned' })
  getConsultations(@CurrentUser() user: JwtPayload) {
    return this.advocateService.getConsultations(user.sub);
  }

  @Get('consultations/:id')
  @Roles('advocate')
  @ApiOperation({ summary: 'Get full details of a single consultation' })
  @ApiParam({ name: 'id', description: 'Consultation UUID' })
  @ApiResponse({ status: 200, description: 'Consultation detail returned' })
  @ApiResponse({ status: 404, description: 'Consultation not found' })
  getConsultationById(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.advocateService.getConsultationById(user.sub, id);
  }

  @Put('consultations/:id')
  @Roles('advocate')
  @ApiOperation({ summary: 'Accept or decline a consultation request' })
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

  @Get('messages')
  @Roles('advocate')
  @ApiOperation({ summary: 'Get chat history for a consultation' })
  @ApiQuery({ name: 'consultationId', description: 'Consultation UUID', required: true })
  @ApiResponse({ status: 200, description: 'Messages returned in chronological order' })
  getMessages(
    @CurrentUser() user: JwtPayload,
    @Query('consultationId') consultationId: string,
  ) {
    return this.advocateService.getMessages(user.sub, consultationId);
  }
}
