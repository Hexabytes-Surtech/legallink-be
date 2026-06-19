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
    // Prefer the X-Anon-Session header (FE localStorage) — it survives incognito, where
    // the cross-site `legallink_session` cookie is dropped as a third-party cookie. Fall
    // back to the cookie, then mint a fresh id.
    const header = req.headers['x-anon-session'];
    const cookie = req.cookies?.[LEGALLINK_SESSION_COOKIE];
    let sessionId: string | undefined;

    if (typeof header === 'string' && UUID_RE.test(header)) sessionId = header;
    else if (typeof cookie === 'string' && UUID_RE.test(cookie)) sessionId = cookie;
    if (!sessionId) sessionId = randomUUID();

    // Keep the cookie aligned (best-effort; harmlessly blocked in incognito).
    if (cookie !== sessionId) {
      res.cookie(LEGALLINK_SESSION_COOKIE, sessionId, {
        ...sessionCookieOptions(),
        maxAge: THIRTY_DAYS_MS,
      });
    }

    req.anonymousSessionId = sessionId;
    next();
  }
}
