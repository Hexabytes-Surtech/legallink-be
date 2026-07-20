import { Body, Controller, Get, Headers, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import { PushService } from './push.service';

interface SubscribeDto {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

@ApiTags('Push')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('push')
export class PushController {
  constructor(private readonly push: PushService) {}

  /** The browser needs this VAPID public key to create a push subscription. */
  @Get('vapid-public-key')
  @ApiOperation({ summary: 'VAPID public key for Web Push subscription' })
  getVapidPublicKey() {
    return { publicKey: this.push.getPublicKey(), enabled: this.push.isEnabled() };
  }

  @Post('subscribe')
  @ApiOperation({ summary: 'Register this device for incoming-call push notifications' })
  async subscribe(
    @CurrentUser() user: JwtPayload,
    @Body() body: SubscribeDto,
    @Headers('user-agent') userAgent?: string,
  ) {
    await this.push.saveSubscription(user.sub, body, userAgent);
    return { ok: true };
  }

  @Post('unsubscribe')
  @ApiOperation({ summary: 'Remove this device from incoming-call push notifications' })
  async unsubscribe(@Body() body: { endpoint: string }) {
    await this.push.removeSubscription(body?.endpoint);
    return { ok: true };
  }
}
