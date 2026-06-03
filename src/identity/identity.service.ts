import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  ConflictException,
  NotFoundException,
  ForbiddenException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';

// Cryptographically-secure 6-digit OTP. randomInt is unbiased over [min, max).
function generateOtp(): string {
  return randomInt(100000, 1000000).toString();
}

// E-4: OTP brute-force guard. In-memory per-email tracker — fine for a single
// instance; move to Redis/DB if the API is ever horizontally scaled.
const MAX_OTP_ATTEMPTS = 5;
const OTP_LOCK_MS = 15 * 60 * 1000; // 15-minute lockout window

@Injectable()
export class IdentityService {
  private otpAttempts = new Map<string, { count: number; lockedUntil: number }>();

  constructor(
    private db: DatabaseService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private emailService: EmailService,
  ) {}

  // ── E-4 OTP brute-force helpers ─────────────────────────────────────────
  private assertOtpNotLocked(email: string) {
    const rec = this.otpAttempts.get(email.toLowerCase());
    if (rec && rec.lockedUntil > Date.now()) {
      const retryAfterSec = Math.ceil((rec.lockedUntil - Date.now()) / 1000);
      throw new HttpException(
        { message: 'OTP_LOCKED', retryAfterSec },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private registerFailedOtp(email: string) {
    const key = email.toLowerCase();
    const rec = this.otpAttempts.get(key) ?? { count: 0, lockedUntil: 0 };
    rec.count += 1;
    if (rec.count >= MAX_OTP_ATTEMPTS) {
      rec.lockedUntil = Date.now() + OTP_LOCK_MS;
      rec.count = 0; // reset counter; lockout window now gates further attempts
    }
    this.otpAttempts.set(key, rec);
  }

  private clearOtpAttempts(email: string) {
    this.otpAttempts.delete(email.toLowerCase());
  }

  // ── API 1 — POST /api/auth/register ─────────────────────────────────────
  async register(email: string, role: string) {
    if (role === 'admin') {
      throw new BadRequestException('Admin role cannot be self-registered');
    }

    if (!['citizen', 'advocate'].includes(role)) {
      throw new BadRequestException('Role must be citizen or advocate');
    }

    const existing = await this.db.query(
      `SELECT id, email_verified FROM users WHERE email = $1`,
      [email],
    );

    if (existing.rows.length > 0 && existing.rows[0].email_verified) {
      throw new ConflictException('Email already registered and verified');
    }

    const otp = generateOtp();
    const otpHash = await bcrypt.hash(otp, 10);
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

    if (existing.rows.length > 0) {
      await this.db.query(
        `UPDATE users
         SET otp_code = $1, otp_expires_at = $2, role = $3, updated_at = now()
         WHERE email = $4`,
        [otpHash, otpExpiresAt, role, email],
      );
    } else {
      await this.db.query(
        `INSERT INTO users (email, role, otp_code, otp_expires_at, email_verified)
         VALUES ($1, $2, $3, $4, false)`,
        [email, role, otpHash, otpExpiresAt],
      );
    }

    await this.sendOtpEmail(email, otp);

    return { expiresInSeconds: 600 };
  }

  // ── API (Login) — POST /api/auth/login ──────────────────────────────────
  async login(email: string) {
    const result = await this.db.query(
      `SELECT id, email_verified FROM users WHERE email = $1`,
      [email],
    );

    if (!result.rows.length) {
      throw new NotFoundException('USER_NOT_FOUND');
    }

    if (!result.rows[0].email_verified) {
      throw new ForbiddenException('EMAIL_NOT_VERIFIED');
    }

    // Generate fresh 6-digit OTP, hash it
    const otp = generateOtp();
    const otpHash = await bcrypt.hash(otp, 10);
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await this.db.query(
      `UPDATE users SET otp_code = $1, otp_expires_at = $2, updated_at = now() WHERE email = $3`,
      [otpHash, otpExpiresAt, email],
    );

    // Send OTP email via Resend
    await this.sendOtpEmail(email, otp);

    return { expiresInSeconds: 600 };
  }

  // ── API 2 — POST /api/auth/verify-otp ───────────────────────────────────
  async verifyOtp(email: string, otp: string, res: any, req?: any) {
    // E-4: reject early if this email is currently locked out from too many bad OTPs.
    this.assertOtpNotLocked(email);

    const result = await this.db.query(
      `SELECT id, role, preferred_language, otp_code, otp_expires_at FROM users WHERE email = $1`,
      [email],
    );

    const user = result.rows[0];

    if (!user) throw new NotFoundException('User not found');

    // Check OTP expiry
    if (!user.otp_expires_at || new Date() > new Date(user.otp_expires_at)) {
      throw new UnauthorizedException('OTP_EXPIRED');
    }

    // Hash-compare incoming OTP against stored hash
    if (!user.otp_code) throw new UnauthorizedException('No OTP requested');
    // Dev-only OTP bypass. Hard-gated on NODE_ENV so a leaked BYPASS_* env in
    // production can never become a full auth bypass. Requires a non-empty code
    // so an empty BYPASS_OTP_CODE can't match an empty submitted otp.
    const bypassCode = this.configService.get<string>('BYPASS_OTP_CODE');
    const bypassOtp =
      process.env.NODE_ENV !== 'production' &&
      this.configService.get<string>('BYPASS_OTP_FOR_TESTING') === 'true' &&
      !!bypassCode &&
      otp === bypassCode;
    if (!bypassOtp) {
      const isMatch = await bcrypt.compare(otp, user.otp_code);
      if (!isMatch) {
        this.registerFailedOtp(email); // E-4: count this failure, lock after the threshold
        throw new UnauthorizedException('INVALID_OTP');
      }
    }

    // E-4: successful verification resets the brute-force counter for this email.
    this.clearOtpAttempts(email);

    // Mark email as verified, clear OTP fields
    await this.db.query(
      `UPDATE users
       SET email_verified = true, otp_code = NULL, otp_expires_at = NULL, updated_at = now()
       WHERE id = $1`,
      [user.id],
    );

    // Auto-create role-specific profile row if it doesn't exist yet
    if (user.role === 'advocate') {
      // BUG-6: Use NULL for bar_enrolment_number so multiple unverified advocates
      // don't conflict on the unique constraint
      await this.db.query(
        `INSERT INTO advocates (user_id, bar_enrolment_number, state_bar, name, address, phone, verification_status)
         VALUES ($1, NULL, '', '', '', '', 'pending')
         ON CONFLICT (user_id) DO NOTHING`,
        [user.id],
      );
    }

    if (user.role === 'citizen') {
      await this.db.query(
        `INSERT INTO citizens (user_id) VALUES ($1)
         ON CONFLICT (user_id) DO NOTHING`,
        [user.id],
      );

      // Claim-on-OTP-verify: any anonymous matters tied to this browser's
      // session cookie are reassigned to the freshly-authenticated user.
      // Also clears expires_at so claimed matters never auto-delete (Category 1B).
      const sessionId: string | undefined = req?.anonymousSessionId;
      if (sessionId) {
        const claim = await this.db.query(
          `UPDATE matter
              SET citizen_id = $1, expires_at = NULL, updated_at = now()
            WHERE citizen_id IS NULL
              AND session_id = $2
          RETURNING matter_id`,
          [user.id, sessionId],
        );
        if (claim.rowCount && claim.rowCount > 0) {
          console.log(
            `[claim] reassigned ${claim.rowCount} matter(s) from session ${sessionId} to user ${user.id}`,
          );
        }
      }
    }

    // Issue tokens
    const accessToken = this.signAccessToken(user.id, user.role, email);
    const refreshToken = this.signRefreshToken(user.id, email);

    // Hash refresh token and store in DB
    const refreshHash = await bcrypt.hash(refreshToken, 10);
    const refreshExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await this.db.query(
      `UPDATE users
       SET refresh_token = $1, refresh_token_expires_at = $2, updated_at = now()
       WHERE id = $3`,
      [refreshHash, refreshExpiresAt, user.id],
    );

    // Set refresh token as httpOnly cookie
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
      path: '/',
    });

    return {
      accessToken,
      user: {
        userId: user.id,
        email,
        role: user.role,
        preferred_language: user.preferred_language,
        email_verified: true,
      },
    };
  }

  // ── API 3 — POST /api/auth/logout ───────────────────────────────────────
  async logout(userId: string, res: any) {
    await this.db.query(
      `UPDATE users SET refresh_token = NULL, refresh_token_expires_at = NULL, updated_at = now() WHERE id = $1`,
      [userId],
    );

    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
    });

    return { message: 'Logged out successfully' };
  }

  // ── API 4 — POST /api/auth/refresh-token ────────────────────────────────
  async refreshAccessToken(req: any) {
    const incomingRefreshToken = req.cookies?.refreshToken;
    if (!incomingRefreshToken) {
      throw new UnauthorizedException('Refresh token not found in cookies');
    }

    // Find user with a valid (non-expired) refresh token
    // We need to check all users since bcrypt hashes aren't searchable
    // Instead, verify the JWT first to get the userId
    let payload: any;
    try {
      payload = this.jwtService.verify(incomingRefreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const result = await this.db.query(
      `SELECT id, email, role, refresh_token, refresh_token_expires_at FROM users WHERE id = $1`,
      [payload.sub],
    );
    const user = result.rows[0];

    if (!user || !user.refresh_token) {
      throw new UnauthorizedException('Session not found');
    }

    // Check expiry
    if (new Date() > new Date(user.refresh_token_expires_at)) {
      throw new UnauthorizedException('Refresh token expired');
    }

    // Compare hashed refresh token
    const isValid = await bcrypt.compare(
      incomingRefreshToken,
      user.refresh_token,
    );
    if (!isValid) throw new UnauthorizedException('Refresh token mismatch');

    // Issue new access token only (no rotation for Phase 1)
    const accessToken = this.signAccessToken(user.id, user.role, user.email);

    return { accessToken };
  }

  // ── Private Helpers ─────────────────────────────────────────────────────

  private signAccessToken(
    userId: string,
    role: string,
    email?: string,
  ): string {
    const payload: Record<string, string> = { sub: userId, role };
    if (email) payload.email = email;
    return this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_ACCESS_SECRET') as string,
      expiresIn: this.configService.get<string>('JWT_ACCESS_EXPIRES_IN') as any,
    });
  }

  private signRefreshToken(userId: string, email?: string): string {
    const payload: Record<string, string> = { sub: userId };
    if (email) payload.email = email;
    return this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_REFRESH_SECRET') as string,
      expiresIn: this.configService.get<string>(
        'JWT_REFRESH_EXPIRES_IN',
      ) as any,
    });
  }

  private async sendOtpEmail(email: string, otp: string) {
    await this.emailService.sendOtp(email, otp);
  }
}
