import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { IceService } from './ice.service';

@ApiTags('Calls')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('calls')
export class CallController {
  constructor(private readonly ice: IceService) {}

  /**
   * ICE servers (STUN + ephemeral TURN) for a 1:1 WebRTC call. The frontend
   * fetches this immediately before starting/accepting a call and hands the
   * array to RTCPeerConnection. TURN credentials are minted server-side here so
   * the provider key is never exposed to the browser.
   */
  @Get('ice-servers')
  @ApiOperation({ summary: 'Get STUN/TURN ICE servers for a 1:1 WebRTC call' })
  @ApiResponse({ status: 200, description: 'iceServers array for RTCPeerConnection' })
  async getIceServers() {
    const iceServers = await this.ice.getIceServers();
    return { iceServers };
  }
}
