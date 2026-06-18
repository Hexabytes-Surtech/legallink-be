import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';
import { ADVOCATE_PLAN_IDS } from '../plans';

export class CreateOrderDto {
  @ApiProperty({
    enum: ADVOCATE_PLAN_IDS,
    example: 'advocate_pro_yearly',
    description: 'Which flat SaaS plan to purchase.',
  })
  @IsString()
  @IsIn(ADVOCATE_PLAN_IDS)
  planId: string;
}
