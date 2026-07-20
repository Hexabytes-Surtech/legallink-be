import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { BillingService } from './billing.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { VerifyPaymentDto } from './dto/verify-payment.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../common/decorators/current-user.decorator';

@ApiTags('Billing')
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  // Public pricing — no auth, so a pricing page can render plans.
  @Get('plans')
  @ApiOperation({ summary: 'List advocate SaaS subscription plans (public pricing)' })
  listPlans() {
    return this.billing.getPlans();
  }

  @Get('subscription')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('advocate')
  @ApiOperation({ summary: "Get the current advocate's subscription status" })
  @ApiResponse({ status: 200, description: '{ plan_id, status, current_period_end, is_active }' })
  getMine(@CurrentUser() user: JwtPayload) {
    return this.billing.getMySubscription(user.sub);
  }

  @Post('order')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('advocate')
  @ApiOperation({ summary: 'Create a Razorpay order for a subscription plan' })
  @ApiResponse({ status: 201, description: '{ orderId, amount, currency, keyId, plan }' })
  @ApiResponse({ status: 400, description: 'Unknown plan' })
  @ApiResponse({ status: 503, description: 'Razorpay not configured' })
  createOrder(@Body() dto: CreateOrderDto, @CurrentUser() user: JwtPayload) {
    return this.billing.createOrder(user.sub, dto.planId);
  }

  @Post('verify')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('advocate')
  @ApiOperation({ summary: 'Verify a completed Razorpay payment and activate the subscription' })
  @ApiResponse({ status: 201, description: '{ alreadyProcessed, subscription }' })
  @ApiResponse({ status: 400, description: 'Signature verification failed' })
  verify(@Body() dto: VerifyPaymentDto, @CurrentUser() user: JwtPayload) {
    return this.billing.verifyAndActivate(user.sub, dto);
  }

  // No auth: authenticity is established by the Razorpay webhook HMAC signature over
  // the RAW request body. Requires { rawBody: true } on the Nest app (see main.ts).
  @Post('webhook')
  @ApiOperation({ summary: 'Razorpay webhook (payment.captured) — verified by signature' })
  webhook(@Req() req: RawBodyRequest<Request>) {
    const signature = req.headers['x-razorpay-signature'] as string | undefined;
    return this.billing.handleWebhook(req.rawBody, signature);
  }
}
