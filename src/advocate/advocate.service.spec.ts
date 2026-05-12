import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { AdvocateService } from './advocate.service';
import { DatabaseService } from '../database/database.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';

describe('AdvocateService', () => {
  let service: AdvocateService;
  let db: jest.Mocked<DatabaseService>;
  let cloudinaryService: jest.Mocked<CloudinaryService>;

  const mockAdvocate = {
    id: 'advocate-uuid-123',
    user_id: 'user-uuid-123',
    name: 'John Doe',
    address: '123 Main St',
    phone: '+919876543210',
    email: 'advocate@example.com',
    bar_enrolment_number: 'WB/1234/2020',
    state_bar: 'West Bengal',
    practice_areas: ['family', 'criminal'],
    courts: ['Calcutta HC', 'District Court'],
    languages: ['en', 'bn'],
    districts: ['kolkata', 'howrah'],
    verification_status: 'pending',
    created_at: new Date(),
    updated_at: new Date(),
  };

  const mockMergedAdvocate = {
    advocate_id: 'advocate-uuid-123',
    name: 'John Doe',
    address: '123 Main St',
    phone: '+919876543210',
    advocate_email: 'advocate@example.com',
    bar_enrolment_number: 'WB/1234/2020',
    state_bar: 'West Bengal',
    practice_areas: ['family', 'criminal'],
    courts: ['Calcutta HC', 'District Court'],
    languages: ['en', 'bn'],
    districts: ['kolkata', 'howrah'],
    verification_status: 'pending',
    created_at: new Date(),
    updated_at: new Date(),
    auth_email: 'user@example.com',
    preferred_language: 'en',
    avatar_url: null,
    user_email: 'user@example.com',
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
        AdvocateService,
        { provide: DatabaseService, useValue: mockDb },
        { provide: CloudinaryService, useValue: mockCloudinaryService },
      ],
    }).compile();

    service = module.get<AdvocateService>(AdvocateService);
    db = module.get(DatabaseService);
    cloudinaryService = module.get(CloudinaryService);

    jest.clearAllMocks();
  });

  describe('getMe', () => {
    it('should return merged advocate profile', async () => {
      db.query.mockResolvedValueOnce({ rows: [mockMergedAdvocate] });

      const result = await service.getMe('user-uuid-123');

      expect(result).toEqual(mockMergedAdvocate);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('JOIN users'),
        ['user-uuid-123'],
      );
    });

    it('should throw NotFoundException when advocate not found', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      await expect(service.getMe('non-existent-user')).rejects.toThrow(
        new NotFoundException({ code: 'ADVOCATE_PROFILE_NOT_FOUND' }),
      );
    });
  });

  describe('getDocuments', () => {
    it('should return list of documents', async () => {
      const mockDocs = [
        {
          id: 'doc-1',
          file_path: 'https://cloudinary.com/doc1.pdf',
          file_type: 'application/pdf',
          uploaded_at: new Date(),
        },
        {
          id: 'doc-2',
          file_path: 'https://cloudinary.com/doc2.jpg',
          file_type: 'image/jpeg',
          uploaded_at: new Date(),
        },
      ];
      db.query.mockResolvedValueOnce({ rows: [mockAdvocate] });
      db.query.mockResolvedValueOnce({ rows: mockDocs });

      const result = await service.getDocuments('user-uuid-123');

      expect(result).toEqual(mockDocs);
      expect(db.query).toHaveBeenCalledTimes(2);
    });

    it('should throw NotFoundException when advocate not found', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      await expect(service.getDocuments('non-existent-user')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateProfile', () => {
    it('should update advocate name', async () => {
      db.query.mockResolvedValueOnce({ rows: [mockAdvocate] });
      db.query.mockResolvedValueOnce({ rows: [] });
      db.query.mockResolvedValueOnce({ rows: [mockMergedAdvocate] });

      const result = await service.updateProfile('user-uuid-123', {
        name: 'Jane Doe',
      });

      expect(result).toEqual(mockMergedAdvocate);
      expect(db.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('UPDATE advocates SET name'),
        expect.arrayContaining(['Jane Doe', 'advocate-uuid-123']),
      );
    });

    it('should update multiple fields', async () => {
      db.query.mockResolvedValueOnce({ rows: [mockAdvocate] });
      db.query.mockResolvedValueOnce({ rows: [] });
      db.query.mockResolvedValueOnce({ rows: [mockMergedAdvocate] });

      const result = await service.updateProfile('user-uuid-123', {
        name: 'Jane Doe',
        phone: '+919988776655',
        practiceAreas: ['property', 'corporate'],
      });

      expect(result).toEqual(mockMergedAdvocate);
      expect(db.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('name'),
        expect.any(Array),
      );
    });

    it('should return current profile when no fields provided', async () => {
      db.query.mockResolvedValueOnce({ rows: [mockAdvocate] });
      db.query.mockResolvedValueOnce({ rows: [mockMergedAdvocate] });

      const result = await service.updateProfile('user-uuid-123', {});

      expect(result).toEqual(mockMergedAdvocate);
      expect(db.query).toHaveBeenCalledTimes(2);
    });

    it('should throw NotFoundException when advocate not found', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      await expect(
        service.updateProfile('non-existent-user', { name: 'Test' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('uploadDocument', () => {
    const mockFile: Express.Multer.File = {
      fieldname: 'document',
      originalname: 'certificate-of-practice.pdf',
      encoding: '7bit',
      mimetype: 'application/pdf',
      buffer: Buffer.from('test-pdf'),
      size: 2048,
      destination: '',
      filename: '',
      path: '',
      stream: null as any,
    };

    it('should upload document and return metadata', async () => {
      const uploadResult = { secure_url: 'https://cloudinary.com/cop.pdf' };
      db.query.mockResolvedValueOnce({ rows: [mockAdvocate] });
      cloudinaryService.uploadFile.mockResolvedValueOnce(uploadResult as any);
      db.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'new-doc-id',
            file_path: 'https://cloudinary.com/cop.pdf',
            file_type: 'application/pdf',
            uploaded_at: new Date(),
          },
        ],
      });

      const result = await service.uploadDocument('user-uuid-123', mockFile);

      expect(result).toEqual({
        documentId: 'new-doc-id',
        file_path: 'https://cloudinary.com/cop.pdf',
        file_type: 'application/pdf',
        uploaded_at: expect.any(Date),
      });
    });

    it('should throw BadRequestException when no file provided', async () => {
      await expect(
        service.uploadDocument('user-uuid-123', null as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for invalid file type', async () => {
      const invalidFile = { ...mockFile, mimetype: 'text/plain' };

      await expect(
        service.uploadDocument('user-uuid-123', invalidFile as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should accept image/jpeg files', async () => {
      const jpegFile = { ...mockFile, mimetype: 'image/jpeg' };
      const uploadResult = { secure_url: 'https://cloudinary.com/cop.jpg' };
      db.query.mockResolvedValueOnce({ rows: [mockAdvocate] });
      cloudinaryService.uploadFile.mockResolvedValueOnce(uploadResult as any);
      db.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'doc-id',
            file_path: 'url',
            file_type: 'image/jpeg',
            uploaded_at: new Date(),
          },
        ],
      });

      const result = await service.uploadDocument('user-uuid-123', jpegFile);

      expect(result.documentId).toBe('doc-id');
    });

    it('should accept image/png files', async () => {
      const pngFile = { ...mockFile, mimetype: 'image/png' };
      const uploadResult = { secure_url: 'https://cloudinary.com/cop.png' };
      db.query.mockResolvedValueOnce({ rows: [mockAdvocate] });
      cloudinaryService.uploadFile.mockResolvedValueOnce(uploadResult as any);
      db.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'doc-id',
            file_path: 'url',
            file_type: 'image/png',
            uploaded_at: new Date(),
          },
        ],
      });

      const result = await service.uploadDocument('user-uuid-123', pngFile);

      expect(result.documentId).toBe('doc-id');
    });
  });
});
