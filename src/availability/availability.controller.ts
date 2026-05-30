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
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../common/decorators/current-user.decorator';

@ApiTags('Advocate Availability')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('advocate')
@Controller('advocate/availability')
export class AvailabilityController {
  constructor(private readonly availabilityService: AvailabilityService) {}

  @Get()
  @ApiOperation({ summary: "Get advocate's own weekly availability grid" })
  @ApiResponse({ status: 200, description: 'Array of availability slots' })
  getOwnGrid(@CurrentUser() user: JwtPayload) {
    return this.availabilityService.getAdvocateOwnGrid(user.sub);
  }

  @Put()
  @ApiOperation({ summary: 'Replace full weekly availability grid' })
  @ApiResponse({ status: 200, description: 'Updated grid returned' })
  @ApiResponse({ status: 400, description: 'Invalid slot data' })
  setOwnGrid(
    @Body() dto: SetAvailabilityDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.availabilityService.setAdvocateOwnGrid(user.sub, dto);
  }
}
