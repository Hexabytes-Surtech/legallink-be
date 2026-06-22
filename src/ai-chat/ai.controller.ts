import { Controller, Post, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { GeminiChatService } from '../ai/gemini-chat.service';
import { OptionalJwtGuard } from '../common/guards/optional-jwt.guard';
import { TranscribeAudioDto } from './dto/transcribe-audio.dto';

@ApiTags('AI')
@Controller('ai')
export class AiController {
  constructor(private readonly geminiChat: GeminiChatService) {}

  // POST /api/ai/transcribe
  // Proxies audio transcription through the backend so the Gemini API key is never
  // exposed to the browser. Tries gemini-2.5-flash-lite first; falls back to
  // gemini-3-flash-preview automatically on 429/503 overload.
  @Post('transcribe')
  @UseGuards(OptionalJwtGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Transcribe audio (STT) via Gemini — API key stays on the server' })
  @ApiResponse({ status: 200, description: '{ text: string }' })
  @ApiResponse({ status: 503, description: 'Gemini unavailable' })
  async transcribe(@Body() dto: TranscribeAudioDto): Promise<{ text: string }> {
    const text = await this.geminiChat.transcribeAudio(dto.audio, dto.lang ?? 'en');
    return { text };
  }
}
