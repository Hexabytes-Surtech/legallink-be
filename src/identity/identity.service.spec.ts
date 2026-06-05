import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { IdentityService } from './identity.service';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';

jest.mock('bcrypt');

describe('IdentityService', () => {
  let service: IdentityService;
  let db: jest.Mocked<DatabaseService>;
  let jwtService: jest.Mocked<JwtService>;
  let emailService: { sendOtp: jest.Mock };

  const mockResponse = {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
  };

  // Returns the row a verified-OTP flow expects for a given role.
  const otpUserRow = (role: string, id = 'user-id') => ({
    id,
    role,
    email_verified: false,
    otp_code: '$2b$10$hashedotp',
    otp_expires_at: new Date(Date.now() + 60000),
    preferred_language: 'en',
  });

  beforeEach(async () => {
    const mockDb = {
      query: jest.fn(),
    };

    const mockJwtService = {
      sign: jest.fn().mockReturnValue('mock-jwt-token'),
      verify: jest.fn(),
    };

    const mockConfigService = {
      get: jest.fn().mockImplementation((key: string) => {
        const config: Record<string, string> = {
          RESEND_API_KEY: 'test-resend-key',
          RESEND_FROM_EMAIL: 'test@example.com',
          JWT_ACCESS_SECRET: 'test-access-secret',
          JWT_ACCESS_EXPIRES_IN: '15m',
          JWT_REFRESH_SECRET: 'test-refresh-secret',
          JWT_REFRESH_EXPIRES_IN: '7d',
        };
        return config[key];
      }),
    };

    const mockEmailService = {
      sendOtp: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdentityService,
        { provide: DatabaseService, useValue: mockDb },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: EmailService, useValue: mockEmailService },
      ],
    }).compile();

    service = module.get<IdentityService>(IdentityService);
    db = module.get(DatabaseService);
    jwtService = module.get(JwtService);
    emailService = module.get(EmailService);

    jest.clearAllMocks();
    (bcrypt.hash as jest.Mock).mockResolvedValue('$2b$10$hashedOtp');
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
  });

  describe('register', () => {
    it('should register a new user and send OTP', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });
      db.query.mockResolvedValueOnce({ rows: [] });

      const result = await service.register('new@example.com', 'citizen');

      expect(result).toEqual({ expiresInSeconds: 600 });
      expect(db.query).toHaveBeenCalledTimes(2);
      expect(db.query).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('SELECT'),
        ['new@example.com'],
      );
      expect(db.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('INSERT INTO users'),
        expect.any(Array),
      );
      expect(emailService.sendOtp).toHaveBeenCalled();
    });

    it('should update OTP for existing unverified user', async () => {
      db.query.mockResolvedValueOnce({
        rows: [{ id: 'existing-id', email_verified: false }],
      });
      db.query.mockResolvedValueOnce({ rows: [] });

      const result = await service.register('existing@example.com', 'citizen');

      expect(result).toEqual({ expiresInSeconds: 600 });
      expect(db.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('UPDATE users'),
        expect.any(Array),
      );
    });

    it('should throw ConflictException for verified email', async () => {
      db.query.mockResolvedValueOnce({
        rows: [{ id: 'existing-id', email_verified: true }],
      });

      await expect(
        service.register('verified@example.com', 'citizen'),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw BadRequestException for admin role', async () => {
      await expect(
        service.register('admin@example.com', 'admin'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for invalid role', async () => {
      await expect(
        service.register('user@example.com', 'invalid'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('login', () => {
    it('should send OTP for verified user', async () => {
      db.query.mockResolvedValueOnce({
        rows: [{ id: 'user-id', email_verified: true }],
      });
      db.query.mockResolvedValueOnce({ rows: [] });

      const result = await service.login('verified@example.com');

      expect(result).toEqual({ expiresInSeconds: 600 });
      expect(db.query).toHaveBeenCalledTimes(2);
      expect(emailService.sendOtp).toHaveBeenCalled();
    });

    it('should throw NotFoundException for non-existent user', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      await expect(service.login('nonexistent@example.com')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException for unverified email', async () => {
      db.query.mockResolvedValueOnce({
        rows: [{ id: 'user-id', email_verified: false }],
      });

      await expect(service.login('unverified@example.com')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('verifyOtp', () => {
    it('should verify OTP and return tokens for citizen', async () => {
      db.query.mockResolvedValueOnce({ rows: [otpUserRow('citizen')] }); // SELECT user
      db.query.mockResolvedValueOnce({ rows: [] }); // UPDATE email_verified
      db.query.mockResolvedValueOnce({ rows: [] }); // INSERT citizens
      db.query.mockResolvedValueOnce({ rows: [] }); // UPDATE refresh token

      const result = await service.verifyOtp(
        'test@example.com',
        '123456',
        mockResponse as any,
      );

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('user');
      expect(result.user.userId).toBe('user-id');
      expect(result.user.email).toBe('test@example.com');
      expect(result.user.role).toBe('citizen');
      expect(mockResponse.cookie).toHaveBeenCalledWith(
        'refreshToken',
        expect.any(String),
        expect.objectContaining({ httpOnly: true, sameSite: 'strict' }),
      );
    });

    it('should claim anonymous matters via session id for citizen', async () => {
      db.query.mockResolvedValueOnce({ rows: [otpUserRow('citizen')] }); // SELECT user
      db.query.mockResolvedValueOnce({ rows: [] }); // UPDATE email_verified
      db.query.mockResolvedValueOnce({ rows: [] }); // INSERT citizens
      db.query.mockResolvedValueOnce({ rows: [], rowCount: 2 }); // claim UPDATE matter
      db.query.mockResolvedValueOnce({ rows: [] }); // UPDATE refresh token

      await service.verifyOtp(
        'test@example.com',
        '123456',
        mockResponse as any,
        { anonymousSessionId: 'sess-abc' } as any,
      );

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE matter'),
        ['user-id', 'sess-abc'],
      );
    });

    it('should create advocate row for advocate role', async () => {
      db.query.mockResolvedValueOnce({ rows: [otpUserRow('advocate', 'advocate-id')] }); // SELECT user
      db.query.mockResolvedValueOnce({ rows: [] }); // UPDATE email_verified
      db.query.mockResolvedValueOnce({ rows: [] }); // INSERT advocates
      db.query.mockResolvedValueOnce({ rows: [] }); // UPDATE refresh token

      await service.verifyOtp(
        'advocate@example.com',
        '123456',
        mockResponse as any,
      );

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO advocates'),
        expect.any(Array),
      );
    });

    it('should throw NotFoundException for non-existent user', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      await expect(
        service.verifyOtp(
          'nonexistent@example.com',
          '123456',
          mockResponse as any,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw UnauthorizedException for expired OTP', async () => {
      db.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'user-id',
            role: 'citizen',
            otp_code: '$2b$10$hash',
            otp_expires_at: new Date(Date.now() - 60000),
          },
        ],
      });

      await expect(
        service.verifyOtp('test@example.com', '123456', mockResponse as any),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException with INVALID_OTP for wrong OTP', async () => {
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(false);
      db.query.mockResolvedValueOnce({ rows: [otpUserRow('citizen')] });

      await expect(
        service.verifyOtp('test@example.com', 'wrong', mockResponse as any),
      ).rejects.toThrow('INVALID_OTP');
    });

    // E-4: OTP brute-force lockout ─────────────────────────────────────────
    it('should lock out (429 / OTP_LOCKED) after 5 failed attempts', async () => {
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      // 5 failed attempts — each throws INVALID_OTP and increments the counter.
      for (let i = 0; i < 5; i++) {
        db.query.mockResolvedValueOnce({ rows: [otpUserRow('citizen')] });
        await expect(
          service.verifyOtp('locked@example.com', 'wrong', mockResponse as any),
        ).rejects.toThrow(UnauthorizedException);
      }

      // 6th attempt is rejected before any DB lookup happens.
      const before = db.query.mock.calls.length;
      try {
        await service.verifyOtp(
          'locked@example.com',
          'wrong',
          mockResponse as any,
        );
        fail('expected lockout to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        expect((err as HttpException).getStatus()).toBe(
          HttpStatus.TOO_MANY_REQUESTS,
        );
        expect((err as HttpException).getResponse()).toMatchObject({
          message: 'OTP_LOCKED',
        });
      }
      // No extra DB query was issued for the locked-out attempt.
      expect(db.query.mock.calls.length).toBe(before);
    });

    it('should clear the failed-attempt counter after a successful verify', async () => {
      // 4 failed attempts (below the lockout threshold of 5).
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      for (let i = 0; i < 4; i++) {
        db.query.mockResolvedValueOnce({ rows: [otpUserRow('citizen')] });
        await expect(
          service.verifyOtp('reset@example.com', 'wrong', mockResponse as any),
        ).rejects.toThrow(UnauthorizedException);
      }

      // A successful verify clears the counter.
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      db.query.mockResolvedValueOnce({ rows: [otpUserRow('citizen')] }); // SELECT
      db.query.mockResolvedValueOnce({ rows: [] }); // UPDATE verified
      db.query.mockResolvedValueOnce({ rows: [] }); // INSERT citizens
      db.query.mockResolvedValueOnce({ rows: [] }); // UPDATE refresh
      await service.verifyOtp('reset@example.com', '123456', mockResponse as any);

      // Counter is cleared, so a fresh wrong OTP only fails (no lockout yet).
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      db.query.mockResolvedValueOnce({ rows: [otpUserRow('citizen')] });
      await expect(
        service.verifyOtp('reset@example.com', 'wrong', mockResponse as any),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('logout', () => {
    it('should clear refresh token and cookie', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      const result = await service.logout('user-id', mockResponse as any);

      expect(result).toEqual({ message: 'Logged out successfully' });
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE users SET refresh_token = NULL'),
        ['user-id'],
      );
      expect(mockResponse.clearCookie).toHaveBeenCalledWith(
        'refreshToken',
        expect.objectContaining({ httpOnly: true }),
      );
    });
  });

  describe('refreshAccessToken', () => {
    it('should issue new access token with valid refresh token', async () => {
      const mockReq = {
        cookies: { refreshToken: 'valid-refresh-token' },
      };
      jwtService.verify.mockReturnValue({
        sub: 'user-id',
        email: 'test@example.com',
      } as any);
      db.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'user-id',
            email: 'test@example.com',
            role: 'citizen',
            refresh_token: '$2b$10$hashed',
            refresh_token_expires_at: new Date(Date.now() + 60000000),
          },
        ],
      });

      const result = await service.refreshAccessToken(mockReq as any);

      expect(result).toHaveProperty('accessToken');
      expect(jwtService.sign).toHaveBeenCalled();
    });

    it('should throw UnauthorizedException when no refresh token in cookies', async () => {
      const mockReq = { cookies: {} };

      await expect(service.refreshAccessToken(mockReq as any)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
