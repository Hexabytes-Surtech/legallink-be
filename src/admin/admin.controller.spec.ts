import { Test, TestingModule } from '@nestjs/testing';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';

describe('AdminController', () => {
  let controller: AdminController;
  let service: jest.Mocked<AdminService>;

  beforeEach(async () => {
    const mockService = {
      getPendingAdvocates: jest.fn(),
      verifyAdvocate: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [{ provide: AdminService, useValue: mockService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AdminController>(AdminController);
    service = module.get(AdminService);

    jest.clearAllMocks();
  });

  describe('getPendingAdvocates', () => {
    it('should return list of pending advocates', async () => {
      const mockAdvocates = [
        { id: 'adv-1', name: 'John Doe', verification_status: 'pending' },
        { id: 'adv-2', name: 'Jane Smith', verification_status: 'pending' },
      ];
      service.getPendingAdvocates.mockResolvedValue(mockAdvocates);

      const result = await controller.getPendingAdvocates();

      expect(result).toEqual(mockAdvocates);
      expect(service.getPendingAdvocates).toHaveBeenCalled();
    });

    it('should return empty array when no pending advocates', async () => {
      service.getPendingAdvocates.mockResolvedValue([]);

      const result = await controller.getPendingAdvocates();

      expect(result).toEqual([]);
    });
  });

  describe('verifyAdvocate', () => {
    it('should approve advocate', async () => {
      const dto = { action: 'approve' as const };
      const expectedResult = {
        advocateId: 'advocate-123',
        verificationStatus: 'verified',
      };
      service.verifyAdvocate.mockResolvedValue(expectedResult);

      const result = await controller.verifyAdvocate('advocate-123', dto);

      expect(result).toEqual(expectedResult);
      expect(service.verifyAdvocate).toHaveBeenCalledWith(
        'advocate-123',
        'approve',
        undefined,
      );
    });

    it('should reject advocate with reason', async () => {
      const dto = { action: 'reject' as const, reason: 'Invalid documents' };
      const expectedResult = {
        advocateId: 'advocate-123',
        verificationStatus: 'rejected',
        reason: 'Invalid documents',
      };
      service.verifyAdvocate.mockResolvedValue(expectedResult);

      const result = await controller.verifyAdvocate('advocate-123', dto);

      expect(result).toEqual(expectedResult);
      expect(service.verifyAdvocate).toHaveBeenCalledWith(
        'advocate-123',
        'reject',
        'Invalid documents',
      );
    });
  });
});
