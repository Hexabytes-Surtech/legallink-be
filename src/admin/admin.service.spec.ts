import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { AdminService } from './admin.service';
import { DatabaseService } from '../database/database.service';

describe('AdminService', () => {
  let service: AdminService;
  let db: jest.Mocked<DatabaseService>;

  const mockPendingAdvocates = [
    {
      id: 'advocate-1',
      bar_enrolment_number: 'WB/1234/2020',
      state_bar: 'West Bengal',
      name: 'John Doe',
      address: '123 Main St',
      phone: '+919876543210',
      email: 'john@example.com',
      practice_areas: ['family'],
      courts: ['Calcutta HC'],
      languages: ['en'],
      districts: ['kolkata'],
      verification_status: 'pending',
      created_at: new Date(),
      user_email: 'john.user@example.com',
      documents: [
        {
          id: 'doc-1',
          fileUrl: 'https://cloudinary.com/doc1.pdf',
          fileType: 'application/pdf',
          uploadedAt: new Date(),
        },
      ],
    },
    {
      id: 'advocate-2',
      bar_enrolment_number: 'WB/5678/2021',
      state_bar: 'West Bengal',
      name: 'Jane Smith',
      address: '456 Oak Ave',
      phone: '+919988776655',
      email: 'jane@example.com',
      practice_areas: ['criminal'],
      courts: ['District Court'],
      languages: ['en', 'bn'],
      districts: ['howrah'],
      verification_status: 'pending',
      created_at: new Date(),
      user_email: 'jane.user@example.com',
      documents: [],
    },
  ];

  beforeEach(async () => {
    const mockDb = {
      query: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [AdminService, { provide: DatabaseService, useValue: mockDb }],
    }).compile();

    service = module.get<AdminService>(AdminService);
    db = module.get(DatabaseService);

    jest.clearAllMocks();
  });

  describe('getPendingAdvocates', () => {
    it('should return list of pending advocates', async () => {
      db.query.mockResolvedValueOnce({ rows: mockPendingAdvocates });

      const result = await service.getPendingAdvocates();

      expect(result).toEqual(mockPendingAdvocates);
      expect(db.query).toHaveBeenCalled();
    });

    it('should return empty array when no pending advocates', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      const result = await service.getPendingAdvocates();

      expect(result).toEqual([]);
    });
  });

  describe('verifyAdvocate', () => {
    it('should approve advocate with action=approve', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ id: 'advocate-1' }] });
      db.query.mockResolvedValueOnce({ rows: [] });

      const result = await service.verifyAdvocate('advocate-1', 'approve');

      expect(result).toEqual({
        advocateId: 'advocate-1',
        verificationStatus: 'verified',
      });
      expect(db.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('UPDATE advocates SET verification_status'),
        ['verified', 'advocate-1'],
      );
    });

    it('should reject advocate with action=reject', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ id: 'advocate-1' }] });
      db.query.mockResolvedValueOnce({ rows: [] });

      const result = await service.verifyAdvocate('advocate-1', 'reject');

      expect(result).toEqual({
        advocateId: 'advocate-1',
        verificationStatus: 'rejected',
      });
      expect(db.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('UPDATE advocates SET verification_status'),
        ['rejected', 'advocate-1'],
      );
    });

    it('should include reason when provided', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ id: 'advocate-1' }] });
      db.query.mockResolvedValueOnce({ rows: [] });

      const result = await service.verifyAdvocate(
        'advocate-1',
        'reject',
        'Invalid documents',
      );

      expect(result).toEqual({
        advocateId: 'advocate-1',
        verificationStatus: 'rejected',
        reason: 'Invalid documents',
      });
    });

    it('should throw NotFoundException for non-existent advocate', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      await expect(
        service.verifyAdvocate('non-existent-id', 'approve'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
