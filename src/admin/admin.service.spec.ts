import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdminService } from './admin.service';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';
import { ConversationGateway } from '../conversation/conversation.gateway';
import { NotificationsGateway } from '../conversation/notifications.gateway';

describe('AdminService', () => {
  let service: AdminService;
  let db: jest.Mocked<DatabaseService>;
  let emailService: { sendAdvocateVerified: jest.Mock; sendAdvocateRejected: jest.Mock };
  let conversationGateway: { emitClearedMessage: jest.Mock };
  let notifications: { emitUnreadBump: jest.Mock };

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
      verification_status: 'submitted',
      submitted_at: new Date(),
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
      verification_status: 'submitted',
      submitted_at: new Date(),
      created_at: new Date(),
      user_email: 'jane.user@example.com',
      documents: [],
    },
  ];

  const mockFlaggedMessages = [
    {
      messageId: 'msg-1',
      consultationId: 'req-1',
      matterId: 'matter-1',
      senderType: 'client',
      senderId: 'user-1',
      content: 'flagged content',
      moderationStatus: 'flagged',
      moderationFlags: ['rule36'],
      createdAt: new Date(),
    },
  ];

  beforeEach(async () => {
    const mockDb = {
      query: jest.fn(),
    };

    const mockEmail = {
      sendAdvocateVerified: jest.fn().mockResolvedValue(undefined),
      sendAdvocateRejected: jest.fn().mockResolvedValue(undefined),
    };

    const mockGateway = {
      emitClearedMessage: jest.fn(),
    };

    const mockNotifications = {
      emitUnreadBump: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: DatabaseService, useValue: mockDb },
        { provide: EmailService, useValue: mockEmail },
        { provide: ConversationGateway, useValue: mockGateway },
        { provide: NotificationsGateway, useValue: mockNotifications },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
    db = module.get(DatabaseService);
    emailService = module.get(EmailService);
    conversationGateway = module.get(ConversationGateway);
    notifications = module.get(NotificationsGateway);

    jest.clearAllMocks();
  });

  describe('getPendingAdvocates', () => {
    it('should return list of pending advocates', async () => {
      db.query.mockResolvedValueOnce({ rows: mockPendingAdvocates });

      const result = await service.getPendingAdvocates();

      expect(result).toEqual(mockPendingAdvocates);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining("verification_status = 'submitted'"),
      );
    });

    it('should return empty array when no pending advocates', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      const result = await service.getPendingAdvocates();

      expect(result).toEqual([]);
    });
  });

  describe('verifyAdvocate', () => {
    it('should approve advocate with action=approve', async () => {
      db.query.mockResolvedValueOnce({
        rows: [{ id: 'advocate-1', name: 'John Doe', user_email: 'john.user@example.com' }],
      });
      db.query.mockResolvedValueOnce({ rows: [] });

      const result = await service.verifyAdvocate('advocate-1', 'approve');

      expect(result).toEqual({
        advocateId: 'advocate-1',
        verificationStatus: 'verified',
      });
      expect(db.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('UPDATE advocates SET verification_status'),
        ['verified', null, 'advocate-1'],
      );
      expect(emailService.sendAdvocateVerified).toHaveBeenCalledWith(
        'john.user@example.com',
        'John Doe',
      );
    });

    it('should reject advocate with action=reject', async () => {
      db.query.mockResolvedValueOnce({
        rows: [{ id: 'advocate-1', name: 'John Doe', user_email: 'john.user@example.com' }],
      });
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
      expect(db.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('UPDATE advocates SET verification_status'),
        ['rejected', 'Invalid documents', 'advocate-1'],
      );
      expect(emailService.sendAdvocateRejected).toHaveBeenCalledWith(
        'john.user@example.com',
        'John Doe',
        'Invalid documents',
      );
    });

    it('should include reason when provided', async () => {
      db.query.mockResolvedValueOnce({
        rows: [{ id: 'advocate-1', name: 'John Doe', user_email: 'john.user@example.com' }],
      });
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

    it('should throw BadRequestException when reject has no reason', async () => {
      db.query.mockResolvedValueOnce({
        rows: [{ id: 'advocate-1', name: 'John Doe', user_email: 'john.user@example.com' }],
      });

      await expect(
        service.verifyAdvocate('advocate-1', 'reject', '   '),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException for non-existent advocate', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      await expect(
        service.verifyAdvocate('non-existent-id', 'approve'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getFlaggedMessages', () => {
    it('should return list of flagged messages', async () => {
      db.query.mockResolvedValueOnce({ rows: mockFlaggedMessages });

      const result = await service.getFlaggedMessages();

      expect(result).toEqual(mockFlaggedMessages);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining("moderation_status = 'flagged'"),
      );
    });
  });

  describe('updateMessageStatus', () => {
    const messageRow = {
      message_id: 'msg-1',
      request_id: 'req-1',
      sender_type: 'client',
      sender_id: 'user-1',
      content: 'hello world',
      created_at: new Date(),
    };

    it('should clear and emit on approve', async () => {
      db.query.mockResolvedValueOnce({ rows: [messageRow] }); // SELECT existing
      db.query.mockResolvedValueOnce({ rows: [] });            // UPDATE status
      db.query.mockResolvedValueOnce({ rows: [{ citizen_id: 'cit-1', advocate_user_id: 'adv-1' }] }); // participants

      const result = await service.updateMessageStatus('msg-1', 'approve');

      expect(result).toEqual({
        messageId: 'msg-1',
        moderationStatus: 'cleared',
        action: 'approve',
      });
      expect(conversationGateway.emitClearedMessage).toHaveBeenCalledWith(
        'req-1',
        expect.objectContaining({
          messageId: 'msg-1',
          senderType: 'client',
          senderId: 'user-1',
          text: 'hello world',
          moderationStatus: 'cleared',
        }),
      );
      // sender is the citizen here → the advocate is the recipient that gets bumped
      expect(notifications.emitUnreadBump).toHaveBeenCalledWith('adv-1', { consultationId: 'req-1' });
    });

    it('should dismiss without emitting on dismiss', async () => {
      db.query.mockResolvedValueOnce({ rows: [messageRow] });
      db.query.mockResolvedValueOnce({ rows: [] });

      const result = await service.updateMessageStatus('msg-1', 'dismiss');

      expect(result).toEqual({
        messageId: 'msg-1',
        moderationStatus: 'dismissed',
        action: 'dismiss',
      });
      expect(conversationGateway.emitClearedMessage).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException for non-existent message', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      await expect(
        service.updateMessageStatus('non-existent', 'approve'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
