import { ConsultationService } from './consultation.service';
import {
  BadRequestException,
  ConflictException,
} from '@nestjs/common';

// A valid future IST 15:30 slot: 10:00Z + 5:30 = 15:30 IST on 2099-06-15.
const FUTURE_ISO = '2099-06-15T10:00:00.000Z';
const MATTER_ID = '11111111-1111-4111-8111-111111111111';
const ADVOCATE_ID = '22222222-2222-4222-8222-222222222222';
const CITIZEN = 'citizen-user-1';
// A grid row that spans the whole day so the slot-bounds check passes.
const FULL_DAY_GRID = {
  start_time: '00:00:00',
  end_time: '23:30:00',
  slot_duration_minutes: 30,
};

describe('ConsultationService (booking safety — Group B)', () => {
  let service: ConsultationService;
  let query: jest.Mock;
  let withTransaction: jest.Mock;

  beforeEach(() => {
    query = jest.fn();
    withTransaction = jest.fn();
    service = new ConsultationService({ query, withTransaction } as any);
  });

  it('rejects a non-UUID advocateId with 400 before hitting the DB', async () => {
    await expect(
      service.requestConsultation(
        { matterId: MATTER_ID, advocateId: 'not-a-uuid' } as any,
        CITIZEN,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects booking with an unverified advocate', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ matter_id: MATTER_ID, citizen_id: CITIZEN, status: 'created' }] }) // matter
      .mockResolvedValueOnce({ rows: [{ id: ADVOCATE_ID, verification_status: 'pending' }] }); // advocate
    await expect(
      service.requestConsultation(
        { matterId: MATTER_ID, advocateId: ADVOCATE_ID } as any,
        CITIZEN,
      ),
    ).rejects.toThrow('ADVOCATE_NOT_VERIFIED');
  });

  it('rejects a scheduledAt that is not an open slot (400 SLOT_NOT_AVAILABLE)', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ matter_id: MATTER_ID, citizen_id: CITIZEN, status: 'created' }] }) // matter
      .mockResolvedValueOnce({ rows: [{ id: ADVOCATE_ID, verification_status: 'verified' }] }) // advocate
      .mockResolvedValueOnce({ rows: [] }); // availability grid — empty → no open slots
    await expect(
      service.requestConsultation(
        { matterId: MATTER_ID, advocateId: ADVOCATE_ID, scheduledAt: FUTURE_ISO } as any,
        CITIZEN,
      ),
    ).rejects.toThrow('SLOT_NOT_AVAILABLE');
  });

  it('rejects a double-booked slot inside the transaction (409 SLOT_ALREADY_BOOKED)', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ matter_id: MATTER_ID, citizen_id: CITIZEN, status: 'created' }] }) // matter
      .mockResolvedValueOnce({ rows: [{ id: ADVOCATE_ID, verification_status: 'verified' }] }) // advocate
      .mockResolvedValueOnce({ rows: [FULL_DAY_GRID] }) // grid → slot is valid
      .mockResolvedValueOnce({ rows: [] }); // no duplicate pending request
    // Transaction: INSERT request → then collision check returns a clash.
    withTransaction.mockImplementation(async (cb: any) => {
      const q = jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ request_id: 'req-1', status: 'pending', matter_id: MATTER_ID, advocate_id: ADVOCATE_ID, citizen_id: CITIZEN, created_at: new Date() }] })
        .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }); // collision found
      return cb(q);
    });
    await expect(
      service.requestConsultation(
        { matterId: MATTER_ID, advocateId: ADVOCATE_ID, scheduledAt: FUTURE_ISO } as any,
        CITIZEN,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('books successfully when slot is open and free', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ matter_id: MATTER_ID, citizen_id: CITIZEN, status: 'created' }] })
      .mockResolvedValueOnce({ rows: [{ id: ADVOCATE_ID, verification_status: 'verified' }] })
      .mockResolvedValueOnce({ rows: [FULL_DAY_GRID] })
      .mockResolvedValueOnce({ rows: [] });
    withTransaction.mockImplementation(async (cb: any) => {
      const q = jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ request_id: 'req-1', status: 'pending', matter_id: MATTER_ID, advocate_id: ADVOCATE_ID, citizen_id: CITIZEN, created_at: new Date() }] })
        .mockResolvedValueOnce({ rows: [] }) // no collision
        .mockResolvedValueOnce({ rows: [] }); // INSERT appointment
      return cb(q);
    });
    const res = await service.requestConsultation(
      { matterId: MATTER_ID, advocateId: ADVOCATE_ID, scheduledAt: FUTURE_ISO } as any,
      CITIZEN,
    );
    expect(res).toEqual(expect.objectContaining({ consultationId: 'req-1', status: 'pending' }));
  });

  describe('closeConsultation (C-2)', () => {
    it('marks the appointment completed in the same transaction as the close', async () => {
      query.mockResolvedValueOnce({ rows: [{ request_id: 'req-1', status: 'accepted', citizen_id: CITIZEN }] });
      const q = jest.fn().mockResolvedValue({ rows: [] });
      withTransaction.mockImplementation(async (cb: any) => cb(q));

      const res = await service.closeConsultation('req-1', CITIZEN);

      expect(res).toEqual({ consultationId: 'req-1', status: 'closed' });
      const sqls = q.mock.calls.map((c) => c[0]).join('\n');
      expect(sqls).toContain('consultation_request');
      expect(sqls).toMatch(/consultation_appointment[\s\S]*completed/);
    });

    it('refuses to close a consultation that is not accepted', async () => {
      query.mockResolvedValueOnce({ rows: [{ request_id: 'req-1', status: 'pending', citizen_id: CITIZEN }] });
      await expect(service.closeConsultation('req-1', CITIZEN)).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
