import type { CookieOptions } from 'express';

/**
 * Security attributes for cookies that must survive a CROSS-SITE context.
 *
 * In production the frontend (Vercel, `*.hexabytes.tech`) and the backend
 * (Railway, `*.up.railway.app`) are different registrable domains → cross-site.
 * A browser only stores/sends a cookie across sites when it is
 * `SameSite=None; Secure`. With `SameSite=Strict`/`Lax` the refresh cookie is
 * silently dropped on the cross-site `/auth/refresh-token` call, which is what
 * logs the user out on every page refresh.
 *
 * Locally everything is `localhost` (same-site) over http, so we fall back to
 * `Lax` without `Secure` (a `Secure` cookie would be rejected over plain http,
 * except on localhost which browsers treat as a secure context anyway).
 *
 * IMPORTANT: this keys off `NODE_ENV`. The backend host (Railway) MUST set
 * `NODE_ENV=production`, otherwise the cookie falls back to `Lax` and the
 * cross-site refresh keeps failing.
 *
 * If you later move the API onto a sub-domain of the frontend
 * (e.g. `api.hexabytes.tech`), the two become same-site and `Lax` would also
 * work — but `None; Secure` keeps working in that case too, so this is safe
 * either way.
 */
export function sessionCookieOptions(): Pick<
  CookieOptions,
  'httpOnly' | 'secure' | 'sameSite' | 'path'
> {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    path: '/',
  };
}
