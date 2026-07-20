import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { AdvocateService } from './advocate.service';
import { DatabaseService } from '../database/database.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { EmailService } from '../email/email.service';
import { NotificationsGateway } from '../conversation/notifications.gateway';

describe('AdvocateService', () => {
  let service: AdvocateService;
  let db: jest.Mocked<DatabaseService>;
  let cloudinaryService: jest.Mocked<CloudinaryService>;
  let emailService: jest.Mocked<EmailService>;

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
    const mockDb: any = {
      query: jest.fn(),
      // Run the transaction body with a `q` that delegates to the mocked query.
      withTransaction: jest.fn((fn: any) => fn((text: string, params?: any[]) => mockDb.query(text, params))),
    };

    const mockCloudinaryService = {
      uploadFile: jest.fn(),
    };

    const mockEmailService = {
      sendConsultationAccepted: jest.fn().mockResolvedValue(undefined),
      sendConsultationDeclined: jest.fn().mockResolvedValue(undefined),
    };

    const mockNotifications = {
      emitDataChanged: jest.fn(),
      emitDataChangedToRole: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdvocateService,
        { provide: DatabaseService, useValue: mockDb },
        { provide: CloudinaryService, useValue: mockCloudinaryService },
        { provide: EmailService, useValue: mockEmailService },
        { provide: NotificationsGateway, useValue: mockNotifications },
      ],
    }).compile();

    service = module.get<AdvocateService>(AdvocateService);
    db = module.get(DatabaseService);
    cloudinaryService = module.get(CloudinaryService);
    emailService = module.get(EmailService);

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

  describe('getConsultations', () => {
    it('should return list of consultations', async () => {
      const mockConsultations = [
        {
          id: 'cons-1',
          status: 'pending',
          requested_at: new Date(),
          updated_at: new Date(),
          citizen_note: null,
          advocate_note: null,
          matter_id: 'matter-1',
          query_text: 'Legal question',
          query_language: 'en',
          classification: 'family',
          citizen_user_id: 'citizen-1',
          citizen_name: 'Citizen',
        },
      ];
      db.query.mockResolvedValueOnce({ rows: [mockAdvocate] });
      db.query.mockResolvedValueOnce({ rows: mockConsultations });

      const result = await service.getConsultations('user-uuid-123');

      expect(result).toEqual(mockConsultations);
    });

    it('should select citizen_name and NOT expose citizen_email (privacy)', async () => {
      db.query.mockResolvedValueOnce({ rows: [mockAdvocate] });
      db.query.mockResolvedValueOnce({ rows: [] });

      await service.getConsultations('user-uuid-123');

      const consultationsSql = db.query.mock.calls[1][0] as string;
      expect(consultationsSql).toEqual(expect.stringContaining('citizen_name'));
      expect(consultationsSql).not.toContain('citizen_email');
    });

    it('should throw NotFoundException when advocate not found', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      await expect(service.getConsultations('non-existent-user')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getConsultationById', () => {
    it('should return consultation detail', async () => {
      const mockConsultation = {
        id: 'cons-1',
        status: 'requested',
        requested_at: new Date(),
        accepted_at: null,
        matter_id: 'matter-1',
        query_text: 'Legal question',
        query_language: 'en',
        classification: 'family',
        citations: null,
        ai_response_english: 'AI response',
        ai_response_bengali: 'AI response bn',
        citizen_user_id: 'citizen-1',
      };
      db.query.mockResolvedValueOnce({ rows: [mockAdvocate] });
      db.query.mockResolvedValueOnce({ rows: [mockConsultation] });

      const result = await service.getConsultationById('user-uuid-123', 'cons-1');

      expect(result).toEqual(mockConsultation);
    });

    it('should throw NotFoundException when consultation not found', async () => {
      db.query.mockResolvedValueOnce({ rows: [mockAdvocate] });
      db.query.mockResolvedValueOnce({ rows: [] });

      await expect(
        service.getConsultationById('user-uuid-123', 'non-existent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateConsultation', () => {
    it('should accept consultation', async () => {
      const existingConsultation = {
        request_id: 'cons-1',
        status: 'pending',
        citizen_id: 'citizen-1',
        matter_summary: 'A legal matter',
        citizen_email: 'citizen@example.com',
      };
      db.query.mockResolvedValueOnce({ rows: [mockAdvocate] });
      db.query.mockResolvedValueOnce({ rows: [existingConsultation] });
      db.query.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // atomic UPDATE … status='pending'

      const result = await service.updateConsultation(
        'user-uuid-123',
        'cons-1',
        'accept',
      );

      expect(result).toEqual({
        consultationId: 'cons-1',
        status: 'accepted',
      });
      expect(emailService.sendConsultationAccepted).toHaveBeenCalledWith(
        'citizen@example.com',
        expect.any(String),
        expect.any(String),
      );
    });

    it('should decline consultation with reason', async () => {
      const existingConsultation = {
        request_id: 'cons-1',
        status: 'pending',
        citizen_id: 'citizen-1',
        matter_summary: 'A legal matter',
        citizen_email: 'citizen@example.com',
      };
      db.query.mockResolvedValueOnce({ rows: [mockAdvocate] });
      db.query.mockResolvedValueOnce({ rows: [existingConsultation] });
      db.query.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // atomic UPDATE … status='pending'

      const result = await service.updateConsultation(
        'user-uuid-123',
        'cons-1',
        'decline',
        'Schedule conflict',
      );

      expect(result).toEqual({
        consultationId: 'cons-1',
        status: 'declined',
        declineReason: 'Schedule conflict',
      });
      expect(emailService.sendConsultationDeclined).toHaveBeenCalledWith(
        'citizen@example.com',
        expect.any(String),
        'Schedule conflict',
      );
    });

    it('should throw NotFoundException when consultation not found', async () => {
      db.query.mockResolvedValueOnce({ rows: [mockAdvocate] });
      db.query.mockResolvedValueOnce({ rows: [] });

      await expect(
        service.updateConsultation('user-uuid-123', 'non-existent', 'accept'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when consultation not in pending state', async () => {
      const existingConsultation = {
        request_id: 'cons-1',
        status: 'accepted',
        citizen_id: 'citizen-1',
        matter_summary: 'A legal matter',
        citizen_email: 'citizen@example.com',
      };
      db.query.mockResolvedValueOnce({ rows: [mockAdvocate] });
      db.query.mockResolvedValueOnce({ rows: [existingConsultation] });

      await expect(
        service.updateConsultation('user-uuid-123', 'cons-1', 'accept'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getDashboard', () => {
    it('should return dashboard with stats', async () => {
      const mockStats = {
        pending_count: '2',
        accepted_count: '5',
        declined_count: '1',
        closed_count: '3',
        total_count: '11',
      };
      db.query.mockResolvedValueOnce({ rows: [mockAdvocate] });
      db.query.mockResolvedValueOnce({ rows: [mockStats] });
      db.query.mockResolvedValueOnce({ rows: [{ average_rating: '4.5' }] });

      const result = await service.getDashboard('user-uuid-123');

      expect(result).toEqual({
        advocateId: 'advocate-uuid-123',
        verificationStatus: 'pending',
        rejectionReason: null,
        profileCompleteness: expect.any(Number),
        consultationStats: mockStats,
        averageRating: 4.5,
      });
    });

    it('should throw NotFoundException when advocate not found', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      await expect(service.getDashboard('non-existent-user')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('submitVerification', () => {
    it('should submit profile for verification', async () => {
      const completeAdvocate = {
        ...mockAdvocate,
        bar_enrolment_number: 'WB/1234/2020',
        state_bar: 'West Bengal',
        name: 'John Doe',
        address: '123 Main St',
      };
      db.query.mockResolvedValueOnce({ rows: [completeAdvocate] });
      db.query.mockResolvedValueOnce({ rows: [] });

      const result = await service.submitVerification('user-uuid-123');

      expect(result).toEqual({
        advocateId: 'advocate-uuid-123',
        verificationStatus: 'submitted',
        message: 'Profile submitted for admin review',
      });
    });

    it('should throw BadRequestException when already verified', async () => {
      const verifiedAdvocate = {
        ...mockAdvocate,
        verification_status: 'verified',
      };
      db.query.mockResolvedValueOnce({ rows: [verifiedAdvocate] });

      await expect(service.submitVerification('user-uuid-123')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException when profile incomplete', async () => {
      const incompleteAdvocate = {
        ...mockAdvocate,
        bar_enrolment_number: '',
        state_bar: 'West Bengal',
        name: 'John Doe',
        address: '',
      };
      db.query.mockResolvedValueOnce({ rows: [incompleteAdvocate] });

      await expect(service.submitVerification('user-uuid-123')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('calculateProfileCompleteness', () => {
    it('should return 100% for complete profile', () => {
      const completeAdvocate = {
        bar_enrolment_number: 'WB/1234/2020',
        state_bar: 'West Bengal',
        name: 'John Doe',
        address: '123 Main St',
        practice_areas: ['family'],
        courts: ['Calcutta HC'],
        languages: ['en'],
        districts: ['kolkata'],
      };
      const completeness = (service as any).calculateProfileCompleteness(completeAdvocate);
      expect(completeness).toBe(100);
    });

    it('should return 0% for empty profile', () => {
      const emptyAdvocate = {
        bar_enrolment_number: '',
        state_bar: '',
        name: '',
        address: '',
        practice_areas: [],
        courts: [],
        languages: [],
        districts: [],
      };
      const completeness = (service as any).calculateProfileCompleteness(emptyAdvocate);
      expect(completeness).toBe(0);
    });

    it('should return 25% for partially complete profile (2 of 8 fields)', () => {
      const halfAdvocate = {
        bar_enrolment_number: 'WB/1234/2020',
        state_bar: 'West Bengal',
        name: '',
        address: '',
        practice_areas: [],
        courts: [],
        languages: [],
        districts: [],
      };
      const completeness = (service as any).calculateProfileCompleteness(halfAdvocate);
      expect(completeness).toBe(25);
    });

    it('should return 50% for half complete profile (4 of 8 fields)', () => {
      const halfAdvocate = {
        bar_enrolment_number: 'WB/1234/2020',
        state_bar: 'West Bengal',
        name: 'John Doe',
        address: '123 Main St',
        practice_areas: [],
        courts: [],
        languages: [],
        districts: [],
      };
      const completeness = (service as any).calculateProfileCompleteness(halfAdvocate);
      expect(completeness).toBe(50);
    });
  });
});
