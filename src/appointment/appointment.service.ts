import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import {
  generateDaySlotKeys,
  instantToIstKey,
  instantToIstParts,
} from '../common/time/ist-time.util';

@Injectable()
export class AppointmentService {
  constructor(private db: DatabaseService) {}

  // ── PUT /api/appointments/:id ─────────────────────────────────────────────
  async updateAppointment(
    appointmentId: string,
    userId: string,
    dto: UpdateAppointmentDto,
  ) {
    // Load appointment with consultation context
    const result = await this.db.query(
      `SELECT ca.id, ca.status, ca.scheduled_at, ca.duration_minutes,
              cr.citizen_id, cr.advocate_id, cr.status AS consultation_status
       FROM consultation_appointment ca
       JOIN consultation_request cr ON cr.request_id = ca.consultation_id
       WHERE ca.id = $1`,
      [appointmentId],
    );
    if (!result.rows.length) throw new NotFoundException('Appointment not found');
    const appt = result.rows[0];

    // Authorise: citizen OR advocate on the consultation
    const advocateRow = await this.db.query(
      `SELECT id FROM advocates WHERE user_id = $1 AND id = $2`,
      [userId, appt.advocate_id],
    );
    const isCitizen = appt.citizen_id === userId;
    const isAdvocate = advocateRow.rows.length > 0;

    if (!isCitizen && !isAdvocate) {
      throw new ForbiddenException('Not authorised to modify this appointment');
    }

    if (appt.status === 'cancelled') {
      throw new BadRequestException('Appointment is already cancelled');
    }
    if (appt.status === 'completed') {
      throw new BadRequestException('Completed appointments cannot be modified');
    }

    if (dto.action === 'cancel') {
      await this.db.query(
        `UPDATE consultation_appointment
         SET status = 'cancelled', updated_at = NOW()
         WHERE id = $1`,
        [appointmentId],
      );
      return { appointmentId, status: 'cancelled' };
    }

    if (dto.action === 'reschedule') {
      if (!dto.scheduledAt) {
        throw new BadRequestException('scheduledAt is required for reschedule');
      }
      // A reschedule must respect the same rules as the original booking — otherwise
      // it is a backdoor around them (the consultation must still be live, the new
      // time must be an open slot, and it must not collide with another booking).
      if (appt.consultation_status !== 'accepted') {
        throw new BadRequestException(
          'Only appointments on accepted consultations can be rescheduled',
        );
      }
      const newTime = new Date(dto.scheduledAt);
      if (isNaN(newTime.getTime())) {
        throw new BadRequestException('Invalid scheduledAt format');
      }
      if (newTime <= new Date()) {
        throw new BadRequestException('scheduledAt must be in the future');
      }

      // Bounds: the new time must fall on one of the advocate's open slots (same IST
      // math + helper as the initial booking in consultation.service — no drift).
      const { date, dayOfWeek } = instantToIstParts(newTime);
      const grid = await this.db.query(
        `SELECT start_time, end_time, slot_duration_minutes
         FROM advocate_availability
         WHERE advocate_id = $1 AND day_of_week = $2 AND is_active = true`,
        [appt.advocate_id, dayOfWeek],
      );
      const openKeys = new Set<string>();
      for (const row of grid.rows) {
        for (const key of generateDaySlotKeys(
          date,
          row.start_time,
          row.end_time,
          row.slot_duration_minutes,
        )) {
          openKeys.add(key);
        }
      }
      if (!openKeys.has(instantToIstKey(newTime))) {
        throw new BadRequestException('SLOT_NOT_AVAILABLE');
      }

      // Collision: no other live booking for this advocate at the new instant.
      const clash = await this.db.query(
        `SELECT 1 FROM consultation_appointment ca
         JOIN consultation_request cr ON cr.request_id = ca.consultation_id
         WHERE cr.advocate_id = $1 AND ca.scheduled_at = $2
           AND ca.status = 'scheduled' AND ca.id <> $3`,
        [appt.advocate_id, newTime.toISOString(), appointmentId],
      );
      if (clash.rows.length) {
        throw new ConflictException('SLOT_ALREADY_BOOKED');
      }

      await this.db.query(
        `UPDATE consultation_appointment
         SET scheduled_at = $1, status = 'scheduled', updated_at = NOW()
         WHERE id = $2`,
        [newTime.toISOString(), appointmentId],
      );
      return {
        appointmentId,
        status: 'scheduled',
        scheduledAt: newTime.toISOString(),
      };
    }

    throw new BadRequestException('action must be cancel or reschedule');
  }
}
