import { AppointmentService } from './appointment.service';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';

const APPT = 'appt-1';
const USER = 'user-1';
const ADV = 'adv-1';
const FUTURE_ISO = '2099-06-15T10:00:00.000Z'; // 15:30 IST, future
const FULL_DAY_GRID = { start_time: '00:00:00', end_time: '23:30:00', slot_duration_minutes: 30 };

function apptRow(over: Record<string, any> = {}) {
  return {
    id: APPT,
    status: 'scheduled',
    scheduled_at: new Date(),
    duration_minutes: 30,
    citizen_id: USER, // requester is the citizen by default
    advocate_id: ADV,
    consultation_status: 'accepted',
    ...over,
  };
}

describe('AppointmentService (reschedule safety)', () => {
  let service: AppointmentService;
  let query: jest.Mock;

  beforeEach(() => {
    query = jest.fn();
    service = new AppointmentService({ query } as any);
  });

  it('forbids a user who is neither the citizen nor the advocate', async () => {
    query
      .mockResolvedValueOnce({ rows: [apptRow({ citizen_id: 'someone-else' })] }) // load
      .mockResolvedValueOnce({ rows: [] }); // not an advocate either
    await expect(
      service.updateAppointment(APPT, USER, { action: 'cancel' } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('cancels a scheduled appointment', async () => {
    query
      .mockResolvedValueOnce({ rows: [apptRow()] })
      .mockResolvedValueOnce({ rows: [] }) // advocate auth lookup (citizen path)
      .mockResolvedValueOnce({ rows: [] }); // UPDATE cancel
    const res = await service.updateAppointment(APPT, USER, { action: 'cancel' } as any);
    expect(res).toEqual({ appointmentId: APPT, status: 'cancelled' });
  });

  it('refuses to reschedule when the consultation is not accepted', async () => {
    query
      .mockResolvedValueOnce({ rows: [apptRow({ consultation_status: 'closed' })] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(
      service.updateAppointment(APPT, USER, { action: 'reschedule', scheduledAt: FUTURE_ISO } as any),
    ).rejects.toThrow('accepted');
  });

  it('rejects a reschedule to a time outside the advocate grid (SLOT_NOT_AVAILABLE)', async () => {
    query
      .mockResolvedValueOnce({ rows: [apptRow()] })
      .mockResolvedValueOnce({ rows: [] }) // auth
      .mockResolvedValueOnce({ rows: [] }); // empty grid → no open slot
    await expect(
      service.updateAppointment(APPT, USER, { action: 'reschedule', scheduledAt: FUTURE_ISO } as any),
    ).rejects.toThrow('SLOT_NOT_AVAILABLE');
  });

  it('rejects a reschedule that collides with another booking (409)', async () => {
    query
      .mockResolvedValueOnce({ rows: [apptRow()] })
      .mockResolvedValueOnce({ rows: [] }) // auth
      .mockResolvedValueOnce({ rows: [FULL_DAY_GRID] }) // grid → slot valid
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }); // collision
    await expect(
      service.updateAppointment(APPT, USER, { action: 'reschedule', scheduledAt: FUTURE_ISO } as any),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('reschedules successfully to a free, in-grid slot', async () => {
    query
      .mockResolvedValueOnce({ rows: [apptRow()] })
      .mockResolvedValueOnce({ rows: [] }) // auth
      .mockResolvedValueOnce({ rows: [FULL_DAY_GRID] }) // grid
      .mockResolvedValueOnce({ rows: [] }) // no collision
      .mockResolvedValueOnce({ rows: [] }); // UPDATE
    const res = await service.updateAppointment(APPT, USER, {
      action: 'reschedule',
      scheduledAt: FUTURE_ISO,
    } as any);
    expect(res).toEqual(
      expect.objectContaining({ appointmentId: APPT, status: 'scheduled', scheduledAt: FUTURE_ISO }),
    );
  });

  it('rejects a reschedule with no scheduledAt', async () => {
    query
      .mockResolvedValueOnce({ rows: [apptRow()] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(
      service.updateAppointment(APPT, USER, { action: 'reschedule' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
