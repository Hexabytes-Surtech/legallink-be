import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  UseGuards,
  Res,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AiChatService } from './ai-chat.service';
import { StartConversationDto } from './dto/start-conversation.dto';
import { PostMessageDto } from './dto/post-message.dto';
import { OptionalJwtGuard } from '../common/guards/optional-jwt.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AnonymousSessionId } from '../common/session/anonymous-session.decorator';

@ApiTags('AI Chat')
@Controller('ai/conversation')
export class AiChatController {
  private readonly logger = new Logger(AiChatController.name);
  constructor(private readonly aiChat: AiChatService) {}

  // ── GET /api/ai/conversation  (history list for the signed-in citizen) ────
  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "List the citizen's past AI chats (titled by first message)" })
  @ApiResponse({ status: 200, description: 'Array of conversation summaries (newest first)' })
  async list(@CurrentUser() user: any) {
    return this.aiChat.listConversations(user.sub);
  }

  // ── DELETE /api/ai/conversation/:id  (remove a chat) ──────────────────────
  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a conversation (its messages; any linked matter is kept)' })
  @ApiResponse({ status: 200, description: 'Conversation deleted' })
  @ApiResponse({ status: 404, description: 'CONVERSATION_NOT_FOUND' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @AnonymousSessionId() sessionId?: string,
  ) {
    return this.aiChat.deleteConversation(id, {
      citizenId: user?.sub ?? null,
      sessionId: sessionId ?? null,
    });
  }

  // ── POST /api/ai/conversation  (start — anonymous or authenticated) ───────
  @Post()
  @UseGuards(OptionalJwtGuard)
  @ApiOperation({ summary: 'Start an AI triage conversation (optionally with a first message)' })
  @ApiResponse({ status: 201, description: 'Conversation created (and first turn if a message was sent)' })
  @ApiResponse({ status: 400, description: 'LANGUAGE_UNSUPPORTED' })
  async start(
    @Body() dto: StartConversationDto,
    @CurrentUser() user?: any,
    @AnonymousSessionId() sessionId?: string,
  ) {
    return this.aiChat.startConversation(dto, {
      citizenId: user?.sub ?? null,
      sessionId: sessionId ?? null,
    });
  }

  // ── POST /api/ai/conversation/:id/message  (one turn) ─────────────────────
  @Post(':id/message')
  @UseGuards(OptionalJwtGuard)
  @ApiOperation({ summary: 'Send a message and get the AI assistant turn' })
  @ApiResponse({ status: 201, description: 'Assistant turn (reply, phase, follow-up, readyToConnect)' })
  @ApiResponse({ status: 400, description: 'MESSAGE_REQUIRED | MESSAGE_TOO_LONG | CONVERSATION_CLOSED' })
  @ApiResponse({ status: 404, description: 'CONVERSATION_NOT_FOUND' })
  @ApiResponse({ status: 503, description: 'AI_UNAVAILABLE | AI_TURN_FAILED' })
  async message(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PostMessageDto,
    @CurrentUser() user?: any,
    @AnonymousSessionId() sessionId?: string,
  ) {
    return this.aiChat.postMessage(id, dto.message, {
      citizenId: user?.sub ?? null,
      sessionId: sessionId ?? null,
    });
  }

  // ── POST /api/ai/conversation/:id/message/stream  (Perplexity-style SSE) ──
  // Streams: step (analyzing/searching/writing) → source (each citation) →
  // token (answer prose) → done (final state). Consumed via fetch + ReadableStream.
  @Post(':id/message/stream')
  @UseGuards(OptionalJwtGuard)
  @ApiOperation({ summary: 'Stream the agent steps + sources + answer for a turn (SSE)' })
  async messageStream(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PostMessageDto,
    @Res() res: Response,
    @CurrentUser() user?: any,
    @AnonymousSessionId() sessionId?: string,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof (res as any).flushHeaders === 'function') (res as any).flushHeaders();
    const caller = { citizenId: user?.sub ?? null, sessionId: sessionId ?? null };
    try {
      for await (const chunk of this.aiChat.streamMessage(id, dto.message, caller)) {
        res.write(chunk);
      }
    } catch (err) {
      const e = err as Error;
      this.logger.error(`SSE stream crashed: conversation=${id} reason="${e.message}"`, e.stack);
      res.write(`event: error\ndata: ${JSON.stringify({ message: e.message })}\n\n`);
    } finally {
      res.end();
    }
  }

  // ── GET /api/ai/conversation/:id  (full transcript + state) ───────────────
  @Get(':id')
  @UseGuards(OptionalJwtGuard)
  @ApiOperation({ summary: 'Get a conversation with its full message history' })
  @ApiResponse({ status: 200, description: 'Conversation + messages' })
  @ApiResponse({ status: 404, description: 'CONVERSATION_NOT_FOUND' })
  async get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user?: any,
    @AnonymousSessionId() sessionId?: string,
  ) {
    return this.aiChat.getConversation(id, {
      citizenId: user?.sub ?? null,
      sessionId: sessionId ?? null,
    });
  }

  // ── POST /api/ai/conversation/:id/connect  (materialize matter) ───────────
  // Requires auth: the citizen must be registered to connect with an advocate.
  @Post(':id/connect')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Promote a ready conversation into a matter + advocate brief' })
  @ApiResponse({ status: 201, description: 'Matter created (or already linked)' })
  @ApiResponse({ status: 400, description: 'NOT_READY_TO_CONNECT | BRIEF_NOT_READY' })
  @ApiResponse({ status: 403, description: 'REGISTRATION_REQUIRED' })
  @ApiResponse({ status: 404, description: 'CONVERSATION_NOT_FOUND' })
  async connect(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @AnonymousSessionId() sessionId?: string,
  ) {
    return this.aiChat.connect(id, {
      citizenId: user?.sub ?? null,
      sessionId: sessionId ?? null,
    });
  }
}
