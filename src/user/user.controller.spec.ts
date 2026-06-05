import { Test, TestingModule } from '@nestjs/testing';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

describe('UserController', () => {
  let controller: UserController;
  let service: jest.Mocked<UserService>;

  beforeEach(async () => {
    const mockService = {
      getMe: jest.fn(),
      updateProfile: jest.fn(),
      uploadAvatar: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [{ provide: UserService, useValue: mockService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<UserController>(UserController);
    service = module.get(UserService);

    jest.clearAllMocks();
  });

  describe('getMe', () => {
    it('should return current user profile', async () => {
      const mockUser = {
        sub: 'user-123',
        role: 'citizen',
        email: 'test@example.com',
      };
      const expectedProfile = {
        id: 'user-123',
        email: 'test@example.com',
        role: 'citizen',
        phone: '+919876543210',
      };
      service.getMe.mockResolvedValue(expectedProfile);

      const result = await controller.getMe(mockUser);

      expect(result).toEqual(expectedProfile);
      expect(service.getMe).toHaveBeenCalledWith('user-123');
    });
  });

  describe('updateProfile', () => {
    it('should update user profile', async () => {
      const mockUser = {
        sub: 'user-123',
        role: 'citizen',
        email: 'test@example.com',
      };
      const dto = { phone: '+919988776655', preferred_language: 'bn' };
      const expectedResult = {
        id: 'user-123',
        email: 'test@example.com',
        phone: '+919988776655',
        preferred_language: 'bn',
      };
      service.updateProfile.mockResolvedValue(expectedResult);

      const result = await controller.updateProfile(mockUser, dto);

      expect(result).toEqual(expectedResult);
      expect(service.updateProfile).toHaveBeenCalledWith('user-123', dto);
    });
  });

  describe('uploadAvatar', () => {
    it('should upload avatar', async () => {
      const mockUser = {
        sub: 'user-123',
        role: 'citizen',
        email: 'test@example.com',
      };
      const mockFile = {
        fieldname: 'avatar',
        originalname: 'test.jpg',
        buffer: Buffer.from('test'),
      } as Express.Multer.File;
      const expectedResult = {
        avatar_url: 'https://cloudinary.com/avatar.jpg',
      };
      service.uploadAvatar.mockResolvedValue(expectedResult);

      const result = await controller.uploadAvatar(mockUser, mockFile);

      expect(result).toEqual(expectedResult);
      expect(service.uploadAvatar).toHaveBeenCalledWith('user-123', mockFile);
    });
  });
});
