import { Test, TestingModule } from '@nestjs/testing';
import { IdentityController } from './identity.controller';
import { IdentityService } from './identity.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

describe('IdentityController', () => {
  let controller: IdentityController;
  let service: jest.Mocked<IdentityService>;

  beforeEach(async () => {
    const mockService = {
      register: jest.fn(),
      login: jest.fn(),
      verifyOtp: jest.fn(),
      logout: jest.fn(),
      refreshAccessToken: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [IdentityController],
      providers: [{ provide: IdentityService, useValue: mockService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<IdentityController>(IdentityController);
    service = module.get(IdentityService);

    jest.clearAllMocks();
  });

  describe('register', () => {
    it('should call register service with correct params', async () => {
      service.register.mockResolvedValue({ expiresInSeconds: 600 });

      const dto = {
        email: 'test@example.com',
        role: 'citizen',
        preferred_language: 'en',
      };
      const result = await controller.register(dto);

      expect(result).toEqual({ expiresInSeconds: 600 });
      expect(service.register).toHaveBeenCalledWith(
        'test@example.com',
        'citizen',
        'en',
      );
    });
  });

  describe('login', () => {
    it('should call login service with email', async () => {
      service.login.mockResolvedValue({ expiresInSeconds: 600 });

      const dto = { email: 'test@example.com' };
      const result = await controller.login(dto);

      expect(result).toEqual({ expiresInSeconds: 600 });
      expect(service.login).toHaveBeenCalledWith('test@example.com');
    });
  });

  describe('verifyOtp', () => {
    it('should call verifyOtp service with email and otp', async () => {
      const mockResponse = {};
      const expectedResult = {
        accessToken: 'jwt-token',
        user: {
          userId: 'user-123',
          email: 'test@example.com',
          role: 'citizen',
        },
      };
      service.verifyOtp.mockResolvedValue(expectedResult);

      const dto = { email: 'test@example.com', otp: '123456' };
      const result = await controller.verifyOtp(dto, mockResponse as any);

      expect(result).toEqual(expectedResult);
      expect(service.verifyOtp).toHaveBeenCalledWith(
        'test@example.com',
        '123456',
        mockResponse,
      );
    });
  });

  describe('logout', () => {
    it('should call logout service with user id', async () => {
      const mockResponse = {};
      const mockUser = {
        sub: 'user-123',
        role: 'citizen',
        email: 'test@example.com',
      };
      service.logout.mockResolvedValue({ message: 'Logged out successfully' });

      const result = await controller.logout(mockUser, mockResponse as any);

      expect(result).toEqual({ message: 'Logged out successfully' });
      expect(service.logout).toHaveBeenCalledWith('user-123', mockResponse);
    });
  });

  describe('refreshToken', () => {
    it('should call refreshAccessToken service', async () => {
      const mockRequest = { cookies: { refreshToken: 'token' } };
      service.refreshAccessToken.mockResolvedValue({
        accessToken: 'new-token',
      });

      const result = await controller.refreshToken(mockRequest as any);

      expect(result).toEqual({ accessToken: 'new-token' });
      expect(service.refreshAccessToken).toHaveBeenCalledWith(mockRequest);
    });
  });
});
