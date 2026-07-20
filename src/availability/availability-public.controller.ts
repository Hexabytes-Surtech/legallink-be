import { Controller, Get, Param, Query, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { AvailabilityService } from './availability.service';

@ApiTags('Advocates (Public)')
@Controller('advocates')
export class AvailabilityPublicController {
  constructor(private readonly availabilityService: AvailabilityService) {}

  @Get(':id/availability')
  @ApiOperation({ summary: "Public: open slots for advocate's next 7 days" })
  @ApiQuery({ name: 'from', required: false, example: '2026-06-01' })
  @ApiQuery({ name: 'to', required: false, example: '2026-06-07' })
  @ApiResponse({
    status: 200,
    description: 'Array of { date, slots: [{ time, available }] }',
  })
  @ApiResponse({ status: 404, description: 'Advocate not found' })
  getPublicSlots(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.availabilityService.getPublicSlots(id, from, to);
  }
}
