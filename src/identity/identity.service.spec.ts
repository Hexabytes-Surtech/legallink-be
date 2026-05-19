import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { IdentityService } from './identity.service';
import { DatabaseService } from '../database/database.service';

jest.mock('bcrypt');

describe('IdentityService', () => {
  let service: IdentityService;
  let db: jest.Mocked<DatabaseService>;
  let jwtService: jest.Mocked<JwtService>;

  const mockUser = {
    id: 'user-uuid-123',
    email: 'test@example.com',
    role: 'citizen',
    preferred_language: 'en',
    email_verified: false,
    otp_code: null,
    otp_expires_at: null,
    refresh_token: null,
    refresh_token_expires_at: null,
  };

  const mockResponse = {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
  };

  const mockResend = {
    emails: {
      send: jest
        .fn()
        .mockResolvedValue({ data: { id: 'email-123' }, error: null }),
    },
  };

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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdentityService,
        { provide: DatabaseService, useValue: mockDb },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<IdentityService>(IdentityService);
    db = module.get(DatabaseService);
    jwtService = module.get(JwtService);

    (service as any).resend = mockResend;

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
      expect(mockResend.emails.send).toHaveBeenCalled();
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
      expect(mockResend.emails.send).toHaveBeenCalled();
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
      const hashedOtp = '$2b$10$hashedotp';
      db.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'user-id',
            role: 'citizen',
            email_verified: false,
            otp_code: hashedOtp,
            otp_expires_at: new Date(Date.now() + 60000),
            preferred_language: 'en',
          },
        ],
      });
      db.query.mockResolvedValueOnce({ rows: [] });
      db.query.mockResolvedValueOnce({ rows: [] });

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

    it('should create advocate row for advocate role', async () => {
      const hashedOtp = '$2b$10$hashedotp';
      db.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'advocate-id',
            role: 'advocate',
            email_verified: false,
            otp_code: hashedOtp,
            otp_expires_at: new Date(Date.now() + 60000),
            preferred_language: 'en',
          },
        ],
      });
      db.query.mockResolvedValueOnce({ rows: [] });
      db.query.mockResolvedValueOnce({ rows: [] });
      db.query.mockResolvedValueOnce({ rows: [] });
      db.query.mockResolvedValueOnce({ rows: [] });

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
      });
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
