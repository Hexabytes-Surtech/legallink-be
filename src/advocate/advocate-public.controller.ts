import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AdvocateService } from './advocate.service';
import { AdvocatesQueryDto } from './dto/advocates-query.dto';

/**
 * Public, JWT-free controller for the advocate directory.
 * Rule 36 BCI compliance: never expose fees, success rates, or outcomes.
 */
@ApiTags('Advocates (Public)')
@Controller('advocates')
export class AdvocatePublicController {
  constructor(private readonly advocateService: AdvocateService) {}

  @Get()
  @ApiOperation({ summary: 'Public paginated advocate directory with filters' })
  @ApiResponse({ status: 200, description: 'Paginated list — card fields only' })
  list(@Query() query: AdvocatesQueryDto) {
    return this.advocateService.getPublicList(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Public advocate profile' })
  @ApiResponse({ status: 200, description: 'Full public profile' })
  @ApiResponse({ status: 404, description: 'Advocate not found' })
  getById(@Param('id', ParseUUIDPipe) id: string) {
    return this.advocateService.getPublicById(id);
  }
}
