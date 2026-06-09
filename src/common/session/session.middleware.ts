import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { sessionCookieOptions } from '../cookies';

export const LEGALLINK_SESSION_COOKIE = 'legallink_session';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Anonymous-session middleware.
 * Reads `legallink_session` httpOnly cookie. If missing or malformed,
 * issues a new UUID and writes it back. Exposes the value as
 * `req.anonymousSessionId` for downstream code (matter creation,
 * claim-on-OTP-verify, etc.).
 */
@Injectable()
export class SessionMiddleware implements NestMiddleware {
  use(req: Request & { anonymousSessionId?: string }, res: Response, next: NextFunction) {
    const incoming = req.cookies?.[LEGALLINK_SESSION_COOKIE];
    let sessionId: string;

    if (typeof incoming === 'string' && UUID_RE.test(incoming)) {
      sessionId = incoming;
    } else {
      sessionId = randomUUID();
      res.cookie(LEGALLINK_SESSION_COOKIE, sessionId, {
        ...sessionCookieOptions(),
        maxAge: THIRTY_DAYS_MS,
      });
    }

    req.anonymousSessionId = sessionId;
    next();
  }
}
