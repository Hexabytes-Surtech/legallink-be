import { Controller, Get, Put, Body, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AvailabilityService } from './availability.service';
import { SetAvailabilityDto } from './dto/set-availability.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { ActiveSubscriptionGuard } from '../common/guards/active-subscription.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../common/decorators/current-user.decorator';

@ApiTags('Advocate Availability')
@ApiBearerAuth()
// TOOLING GATE: the advocate's scheduling calendar is a paid SaaS tool (docs/MONETIZATION_PLAN.md
// §5.1). This is safe under Rule 36 because it does NOT touch reachability — a non-subscribing
// verified advocate stays listed and can still receive/accept citizen-initiated consultations
// (those flows are deliberately ungated). The public read of an advocate's slots lives in
// AvailabilityPublicController and is intentionally NOT gated.
@UseGuards(JwtAuthGuard, RolesGuard, ActiveSubscriptionGuard)
@Roles('advocate')
@Controller('advocate/availability')
export class AvailabilityController {
  constructor(private readonly availabilityService: AvailabilityService) {}

  @Get()
  @ApiOperation({ summary: "Get advocate's own weekly availability grid" })
  @ApiResponse({ status: 200, description: 'Array of availability slots' })
  @ApiResponse({ status: 402, description: 'Active Advocate Pro subscription required (SUBSCRIPTION_REQUIRED)' })
  getOwnGrid(@CurrentUser() user: JwtPayload) {
    return this.availabilityService.getAdvocateOwnGrid(user.sub);
  }

  @Put()
  @ApiOperation({ summary: 'Replace full weekly availability grid' })
  @ApiResponse({ status: 200, description: 'Updated grid returned' })
  @ApiResponse({ status: 400, description: 'Invalid slot data' })
  @ApiResponse({ status: 402, description: 'Active Advocate Pro subscription required (SUBSCRIPTION_REQUIRED)' })
  setOwnGrid(
    @Body() dto: SetAvailabilityDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.availabilityService.setAdvocateOwnGrid(user.sub, dto);
  }
}
