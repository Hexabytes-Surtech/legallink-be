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
});
