import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { MatterService } from './matter.service';
import { CreateMatterDto } from './dto/create-matter.dto';
import { OptionalJwtGuard } from '../common/guards/optional-jwt.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Matter')
@Controller('matter')
export class MatterController {
  constructor(private readonly matterService: MatterService) {}

  // ── POST /api/matter  (anonymous or authenticated) ───────────────────────
  @Post()
  @UseGuards(OptionalJwtGuard)
  @ApiOperation({ summary: 'Submit a legal query — creates a matter with AI response' })
  @ApiResponse({ status: 201, description: 'Matter created with AI response and advocate matches' })
  @ApiResponse({ status: 400, description: 'QUERY_REQUIRED | QUERY_TOO_LONG | LANGUAGE_UNSUPPORTED' })
  async createMatter(
    @Body() dto: CreateMatterDto,
    @CurrentUser() user?: any,
  ) {
    return this.matterService.createMatter(dto, user?.sub ?? null);
  }

  // ── GET /api/matter/:id ──────────────────────────────────────────────────
  @Get(':id')
  @UseGuards(OptionalJwtGuard)
  @ApiOperation({ summary: 'Get matter details with AI response and citations' })
  @ApiResponse({ status: 200, description: 'Matter detail' })
  @ApiResponse({ status: 404, description: 'MATTER_NOT_FOUND' })
  async getMatter(
    @Param('id') id: string,
    @CurrentUser() user?: any,
  ) {
    return this.matterService.getMatterById(id, user?.sub ?? null);
  }

  // ── GET /api/matter/:id/advocates ─────────────────────────────────────────
  @Get(':id/advocates')
  @UseGuards(OptionalJwtGuard)
  @ApiOperation({ summary: 'Get verified advocates matching this matter' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 5 })
  @ApiResponse({ status: 200, description: 'Paginated advocate matches' })
  async getAdvocates(
    @Param('id') id: string,
    @Query('page') page = '1',
    @Query('limit') limit = '5',
    @CurrentUser() user?: any,
  ) {
    return this.matterService.getMatchingAdvocates(
      id,
      user?.sub ?? null,
      Number(page),
      Number(limit),
    );
  }
}
