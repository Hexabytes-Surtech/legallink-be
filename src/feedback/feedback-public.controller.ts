import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { FeedbackService } from './feedback.service';

@ApiTags('Feedback (Public)')
@Controller('advocates')
export class FeedbackPublicController {
  constructor(private feedbackService: FeedbackService) {}

  // GET /api/advocates/:id/feedback
  @Get(':id/feedback')
  @ApiOperation({ summary: 'Public avg rating + last 5 visible reviews for an advocate' })
  getAdvocateFeedback(@Param('id', ParseUUIDPipe) id: string) {
    return this.feedbackService.getAdvocateFeedback(id);
  }
}
