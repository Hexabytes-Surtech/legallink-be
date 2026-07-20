import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import { FeedbackService } from './feedback.service';
import { CreateFeedbackDto } from './dto/create-feedback.dto';

@ApiTags('Feedback')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class FeedbackController {
  constructor(private feedbackService: FeedbackService) {}

  // POST /api/consultations/:id/feedback — citizen only
  @Post('consultations/:id/feedback')
  @UseGuards(RolesGuard)
  @Roles('citizen')
  submitFeedback(
    @Param('id', ParseUUIDPipe) consultationId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateFeedbackDto,
  ) {
    return this.feedbackService.submitFeedback(user.sub, consultationId, dto);
  }

  // GET /api/advocate/reviews — advocate's own full review list
  @Get('advocate/reviews')
  @UseGuards(RolesGuard)
  @Roles('advocate')
  getMyReviews(@CurrentUser() user: JwtPayload) {
    return this.feedbackService.getMyReviews(user.sub);
  }
}
