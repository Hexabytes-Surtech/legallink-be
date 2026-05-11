import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import * as bcrypt from 'bcrypt';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class IdentityService {
  private resend: Resend;

  constructor(
    private db: DatabaseService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {
    this.resend = new Resend(this.configService.get<string>('RESEND_API_KEY'));
  }

  // ── Request OTP ──────────────────────────────────────────────────────────────
  async requestOtp(email: string) {
    // Generate a random 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    try {
      // Upsert user: create if not exists, then store OTP
      await this.db.query(
        `INSERT INTO users (email, role, otp_code, otp_expires_at)
         VALUES ($1, 'citizen', $2, $3)
         ON CONFLICT (email) DO UPDATE
           SET otp_code = $2, otp_expires_at = $3, updated_at = now()`,
        [email, otp, expiresAt],
      );

      // Send OTP email via Resend
      const emailResponse = await this.resend.emails.send({
        from: this.configService.get<string>('RESEND_FROM_EMAIL') as string,
        to: email,
        subject: 'Your LegalLink OTP',
        html: `<p>Your OTP is <strong>${otp}</strong>. It expires in 5 minutes.</p>`,
      });

      if (emailResponse.error) {
        console.error('Resend error:', emailResponse.error);
        throw new Error(`Resend Error: ${emailResponse.error.message}`);
      }

      return { expiresInSeconds: 300, retryAfterSeconds: 30 };
    } catch (error) {
      console.error('requestOtp Error:', error);
      throw error;
    }
  }

  // ── Verify OTP & Issue Tokens ─────────────────────────────────────────────
  async verifyOtp(email: string, otp: string) {
    const result = await this.db.query(
      `SELECT id, role, otp_code, otp_expires_at FROM users WHERE email = $1`,
      [email],
    );

    const user = result.rows[0];

    if (!user) throw new UnauthorizedException('User not found');
    if (!user.otp_code) throw new UnauthorizedException('No OTP requested');
    if (new Date() > new Date(user.otp_expires_at)) {
      throw new UnauthorizedException('OTP has expired');
    }

    if (otp !== user.otp_code) throw new UnauthorizedException('Invalid OTP');

    // Clear OTP fields + mark email as verified
    await this.db.query(
      `UPDATE users
       SET otp_code = NULL, otp_expires_at = NULL, email_verified = true, updated_at = now()
       WHERE id = $1`,
      [user.id],
    );

    // Issue tokens — role stored in DB is the source of truth
    const tokens = await this.issueTokens(user.id, email, user.role);
    return { ...tokens, user: { userId: user.id, email, role: user.role } };
  }

  // ── Refresh Access Token ──────────────────────────────────────────────────
  async refreshAccessToken(incomingRefreshToken: string) {
    // Decode to get userId (don't trust the payload fully yet)
    let payload: any;
    try {
      payload = this.jwtService.verify(incomingRefreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const result = await this.db.query(
      `SELECT id, email, role, refresh_token FROM users WHERE id = $1`,
      [payload.sub],
    );
    const user = result.rows[0];

    if (!user || !user.refresh_token) {
      throw new UnauthorizedException('Session not found');
    }

    const isValid = await bcrypt.compare(incomingRefreshToken, user.refresh_token);
    if (!isValid) throw new UnauthorizedException('Refresh token mismatch');

    const tokens = await this.issueTokens(user.id, user.email, user.role);
    return tokens;
  }

  // ── Private Helpers ────────────────────────────────────────────────────────
  // Issues both access and refresh JWTs and stores the hashed refresh token
  async issueTokens(userId: string, email: string, role: string) {
    const payload = { sub: userId, email, role };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_ACCESS_SECRET') as string,
      expiresIn: (this.configService.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '15m') as any,
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_REFRESH_SECRET') as string,
      expiresIn: (this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '7d') as any,
    });

    const refreshHash = await bcrypt.hash(refreshToken, 10);
    const refreshExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await this.db.query(
      `UPDATE users
       SET refresh_token = $1, refresh_token_expires_at = $2, updated_at = now()
       WHERE id = $3`,
      [refreshHash, refreshExpiresAt, userId],
    );

    return { accessToken, refreshToken };
  }
}
