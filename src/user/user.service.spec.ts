import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { UserService } from './user.service';
import { DatabaseService } from '../database/database.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';

describe('UserService', () => {
  let service: UserService;
  let db: jest.Mocked<DatabaseService>;
  let cloudinaryService: jest.Mocked<CloudinaryService>;

  const mockUser = {
    id: 'user-uuid-123',
    email: 'test@example.com',
    email_verified: true,
    role: 'citizen',
    phone: '+919876543210',
    preferred_language: 'en',
    avatar_url: 'https://cloudinary.com/avatar.jpg',
    created_at: new Date(),
    updated_at: new Date(),
  };

  beforeEach(async () => {
    const mockDb = {
      query: jest.fn(),
    };

    const mockCloudinaryService = {
      uploadFile: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: DatabaseService, useValue: mockDb },
        { provide: CloudinaryService, useValue: mockCloudinaryService },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
    db = module.get(DatabaseService);
    cloudinaryService = module.get(CloudinaryService);

    jest.clearAllMocks();
  });

  describe('getMe', () => {
    it('should return user profile', async () => {
      db.query.mockResolvedValueOnce({ rows: [mockUser] });

      const result = await service.getMe('user-uuid-123');

      expect(result).toEqual(mockUser);
      expect(db.query).toHaveBeenCalledWith(expect.stringContaining('SELECT'), [
        'user-uuid-123',
      ]);
    });

    it('should throw NotFoundException for non-existent user', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      await expect(service.getMe('non-existent-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateProfile', () => {
    it('should update phone only', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });
      db.query.mockResolvedValueOnce({ rows: [mockUser] });

      const result = await service.updateProfile('user-uuid-123', {
        phone: '+919876543210',
      });

      expect(result).toEqual(mockUser);
      expect(db.query).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('UPDATE users SET phone'),
        expect.arrayContaining(['+919876543210', 'user-uuid-123']),
      );
    });

    it('should update preferred_language only', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });
      db.query.mockResolvedValueOnce({ rows: [mockUser] });

      const result = await service.updateProfile('user-uuid-123', {
        preferred_language: 'bn',
      });

      expect(result).toEqual(mockUser);
      expect(db.query).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('UPDATE users SET preferred_language'),
        expect.arrayContaining(['bn', 'user-uuid-123']),
      );
    });

    it('should update both phone and preferred_language', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });
      db.query.mockResolvedValueOnce({ rows: [mockUser] });

      const result = await service.updateProfile('user-uuid-123', {
        phone: '+919876543210',
        preferred_language: 'bn',
      });

      expect(result).toEqual(mockUser);
      expect(db.query).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('phone'),
        expect.any(Array),
      );
      expect(db.query).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('preferred_language'),
        expect.any(Array),
      );
    });

    it('should return current user when no fields provided', async () => {
      db.query.mockResolvedValueOnce({ rows: [mockUser] });

      const result = await service.updateProfile('user-uuid-123', {});

      expect(result).toEqual(mockUser);
      expect(db.query).toHaveBeenCalledTimes(1);
    });
  });

  describe('uploadAvatar', () => {
    const mockFile: Express.Multer.File = {
      fieldname: 'avatar',
      originalname: 'test-avatar.jpg',
      encoding: '7bit',
      mimetype: 'image/jpeg',
      buffer: Buffer.from('test-image'),
      size: 1024,
      destination: '',
      filename: '',
      path: '',
      stream: null as any,
    };

    it('should upload avatar and return URL', async () => {
      const uploadResult = {
        secure_url: 'https://cloudinary.com/new-avatar.jpg',
      };
      cloudinaryService.uploadFile.mockResolvedValueOnce(uploadResult as any);
      db.query.mockResolvedValueOnce({ rows: [] });

      const result = await service.uploadAvatar('user-uuid-123', mockFile);

      expect(result).toEqual({
        avatar_url: 'https://cloudinary.com/new-avatar.jpg',
      });
      expect(cloudinaryService.uploadFile).toHaveBeenCalledWith(
        mockFile,
        expect.any(String),
        'user-uuid-123',
      );
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE users SET avatar_url'),
        expect.arrayContaining([
          'https://cloudinary.com/new-avatar.jpg',
          'user-uuid-123',
        ]),
      );
    });
  });
});
