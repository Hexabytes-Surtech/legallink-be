import { Test, TestingModule } from '@nestjs/testing';
import { AdvocateController } from './advocate.controller';
import { AdvocateService } from './advocate.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';

describe('AdvocateController', () => {
  let controller: AdvocateController;
  let service: jest.Mocked<AdvocateService>;

  beforeEach(async () => {
    const mockService = {
      getMe: jest.fn(),
      getDocuments: jest.fn(),
      updateProfile: jest.fn(),
      uploadDocument: jest.fn(),
      getConsultations: jest.fn(),
      getConsultationById: jest.fn(),
      updateConsultation: jest.fn(),
      getDashboard: jest.fn(),
      submitVerification: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdvocateController],
      providers: [{ provide: AdvocateService, useValue: mockService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AdvocateController>(AdvocateController);
    service = module.get(AdvocateService);

    jest.clearAllMocks();
  });

  describe('getMe', () => {
    it('should return advocate profile', async () => {
      const mockUser = {
        sub: 'user-123',
        role: 'advocate',
        email: 'advocate@example.com',
      };
      const expectedProfile = {
        advocate_id: 'advocate-123',
        name: 'John Doe',
        verification_status: 'pending',
      };
      service.getMe.mockResolvedValue(expectedProfile);

      const result = await controller.getMe(mockUser);

      expect(result).toEqual(expectedProfile);
      expect(service.getMe).toHaveBeenCalledWith('user-123');
    });
  });

  describe('getDocuments', () => {
    it('should return list of documents', async () => {
      const mockUser = {
        sub: 'user-123',
        role: 'advocate',
        email: 'advocate@example.com',
      };
      const expectedDocs = [
        {
          id: 'doc-1',
          file_path: 'https://cloud.com/doc1.pdf',
          file_type: 'application/pdf',
        },
        {
          id: 'doc-2',
          file_path: 'https://cloud.com/doc2.jpg',
          file_type: 'image/jpeg',
        },
      ];
      service.getDocuments.mockResolvedValue(expectedDocs);

      const result = await controller.getDocuments(mockUser);

      expect(result).toEqual(expectedDocs);
      expect(service.getDocuments).toHaveBeenCalledWith('user-123');
    });
  });

  describe('updateProfile', () => {
    it('should update advocate profile', async () => {
      const mockUser = {
        sub: 'user-123',
        role: 'advocate',
        email: 'advocate@example.com',
      };
      const dto = { name: 'Jane Doe', barEnrolmentNumber: 'WB/5678/2021' };
      const expectedResult = {
        advocate_id: 'advocate-123',
        name: 'Jane Doe',
        bar_enrolment_number: 'WB/5678/2021',
      };
      service.updateProfile.mockResolvedValue(expectedResult);

      const result = await controller.updateProfile(mockUser, dto);

      expect(result).toEqual(expectedResult);
      expect(service.updateProfile).toHaveBeenCalledWith('user-123', dto);
    });
  });

  describe('uploadDocument', () => {
    it('should upload document', async () => {
      const mockUser = {
        sub: 'user-123',
        role: 'advocate',
        email: 'advocate@example.com',
      };
      const mockFile = {
        fieldname: 'document',
        originalname: 'cop.pdf',
        mimetype: 'application/pdf',
        buffer: Buffer.from('test-pdf'),
      } as Express.Multer.File;
      const expectedResult = {
        documentId: 'doc-123',
        file_path: 'https://cloud.com/cop.pdf',
        file_type: 'application/pdf',
        uploaded_at: new Date(),
      };
      service.uploadDocument.mockResolvedValue(expectedResult);

      const result = await controller.uploadDocument(mockUser, mockFile);

      expect(result).toEqual(expectedResult);
      expect(service.uploadDocument).toHaveBeenCalledWith('user-123', mockFile);
    });
  });

  describe('getDashboard', () => {
    it('should return dashboard data', async () => {
      const mockUser = {
        sub: 'user-123',
        role: 'advocate',
        email: 'advocate@example.com',
      };
      const expectedData = {
        advocateId: 'advocate-123',
        verificationStatus: 'pending',
        profileCompleteness: 75,
        consultationStats: {
          pending_count: '2',
          accepted_count: '5',
          declined_count: '1',
          closed_count: '3',
          total_count: '11',
        },
      };
      service.getDashboard.mockResolvedValue(expectedData);

      const result = await controller.getDashboard(mockUser);

      expect(result).toEqual(expectedData);
      expect(service.getDashboard).toHaveBeenCalledWith('user-123');
    });
  });

  describe('getConsultations', () => {
    it('should return list of consultations', async () => {
      const mockUser = {
        sub: 'user-123',
        role: 'advocate',
        email: 'advocate@example.com',
      };
      const expectedConsultations = [
        {
          id: 'cons-1',
          status: 'requested',
          requested_at: new Date(),
          query_text: 'Legal question',
        },
      ];
      service.getConsultations.mockResolvedValue(expectedConsultations);

      const result = await controller.getConsultations(mockUser);

      expect(result).toEqual(expectedConsultations);
      expect(service.getConsultations).toHaveBeenCalledWith('user-123');
    });
  });

  describe('getConsultationById', () => {
    it('should return consultation detail', async () => {
      const mockUser = {
        sub: 'user-123',
        role: 'advocate',
        email: 'advocate@example.com',
      };
      const expectedConsultation = {
        id: 'cons-1',
        status: 'requested',
        matter_id: 'matter-1',
        query_text: 'Legal question',
      };
      service.getConsultationById.mockResolvedValue(expectedConsultation);

      const result = await controller.getConsultationById(mockUser, 'cons-1');

      expect(result).toEqual(expectedConsultation);
      expect(service.getConsultationById).toHaveBeenCalledWith('user-123', 'cons-1');
    });
  });

  describe('updateConsultation', () => {
    it('should accept consultation', async () => {
      const mockUser = {
        sub: 'user-123',
        role: 'advocate',
        email: 'advocate@example.com',
      };
      const dto = { action: 'accept' as const };
      const expectedResult = {
        consultationId: 'cons-1',
        status: 'accepted',
      };
      service.updateConsultation.mockResolvedValue(expectedResult);

      const result = await controller.updateConsultation(mockUser, 'cons-1', dto);

      expect(result).toEqual(expectedResult);
      expect(service.updateConsultation).toHaveBeenCalledWith(
        'user-123',
        'cons-1',
        'accept',
        undefined,
      );
    });

    it('should decline consultation with reason', async () => {
      const mockUser = {
        sub: 'user-123',
        role: 'advocate',
        email: 'advocate@example.com',
      };
      const dto = { action: 'decline' as const, declineReason: 'Schedule conflict' };
      const expectedResult = {
        consultationId: 'cons-1',
        status: 'declined',
        declineReason: 'Schedule conflict',
      };
      service.updateConsultation.mockResolvedValue(expectedResult);

      const result = await controller.updateConsultation(mockUser, 'cons-1', dto);

      expect(result).toEqual(expectedResult);
      expect(service.updateConsultation).toHaveBeenCalledWith(
        'user-123',
        'cons-1',
        'decline',
        'Schedule conflict',
      );
    });
  });

  describe('submitVerification', () => {
    it('should submit profile for verification', async () => {
      const mockUser = {
        sub: 'user-123',
        role: 'advocate',
        email: 'advocate@example.com',
      };
      const expectedResult = {
        advocateId: 'advocate-123',
        verificationStatus: 'pending',
        message: 'Profile submitted for admin review',
      };
      service.submitVerification.mockResolvedValue(expectedResult);

      const result = await controller.submitVerification(mockUser);

      expect(result).toEqual(expectedResult);
      expect(service.submitVerification).toHaveBeenCalledWith('user-123');
    });
  });
});
