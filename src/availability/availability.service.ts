import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { SetAvailabilityDto } from './dto/set-availability.dto';
import {
  addDays,
  dateStrToDayOfWeek,
  generateDaySlotKeys,
  instantToIstKey,
  istToday,
  istWallClockToInstant,
  nowIstKey,
} from '../common/time/ist-time.util';

@Injectable()
export class AvailabilityService {
  constructor(private db: DatabaseService) {}

  // ── GET /api/advocate/availability ───────────────────────────────────────
  async getAdvocateOwnGrid(userId: string) {
    const advocate = await this.getAdvocateByUserId(userId);
    const result = await this.db.query(
      `SELECT id, day_of_week, start_time, end_time, slot_duration_minutes, is_active
       FROM advocate_availability
       WHERE advocate_id = $1
       ORDER BY day_of_week, start_time`,
      [advocate.id],
    );
    return result.rows;
  }

  // ── PUT /api/advocate/availability ───────────────────────────────────────
  async setAdvocateOwnGrid(userId: string, dto: SetAvailabilityDto) {
    const advocate = await this.getAdvocateByUserId(userId);

    // Validate all slots before touching the DB
    for (const slot of dto.slots) {
      if (slot.dayOfWeek < 0 || slot.dayOfWeek > 6) {
        throw new BadRequestException(`Invalid dayOfWeek: ${slot.dayOfWeek}`);
      }
      if (!this.isValidTime(slot.startTime) || !this.isValidTime(slot.endTime)) {
        throw new BadRequestException('startTime and endTime must be HH:MM format');
      }
      if (slot.startTime >= slot.endTime) {
        throw new BadRequestException('endTime must be after startTime');
      }
    }

    // Full replace in a transaction: delete all then re-insert
    await this.db.withTransaction(async (q) => {
      await q(
        `DELETE FROM advocate_availability WHERE advocate_id = $1`,
        [advocate.id],
      );
      for (const slot of dto.slots) {
        await q(
          `INSERT INTO advocate_availability
             (advocate_id, day_of_week, start_time, end_time, slot_duration_minutes)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            advocate.id,
            slot.dayOfWeek,
            slot.startTime,
            slot.endTime,
            slot.slotDurationMinutes ?? 30,
          ],
        );
      }
    });

    return this.getAdvocateOwnGrid(userId);
  }

  // ── GET /api/advocates/:id/availability?from=&to= ─────────────────────────
  async getPublicSlots(advocateId: string, fromStr?: string, toStr?: string) {
    // Verify advocate exists
    const advocateCheck = await this.db.query(
      `SELECT id FROM advocates WHERE id = $1`,
      [advocateId],
    );
    if (!advocateCheck.rows.length) throw new NotFoundException('Advocate not found');

    // Resolve date range (defaults: IST today → +6). Dates are IST calendar dates.
    const fromDate = fromStr ?? istToday();
    const toDate = toStr ?? addDays(fromDate, 6);

    // Fetch weekly grid
    const gridResult = await this.db.query(
      `SELECT day_of_week, start_time, end_time, slot_duration_minutes
       FROM advocate_availability
       WHERE advocate_id = $1 AND is_active = true
       ORDER BY day_of_week, start_time`,
      [advocateId],
    );
    if (!gridResult.rows.length) return [];

    // Fetch booked appointments in the IST date range. scheduled_at is timestamptz
    // (a true UTC instant); the IST day [fromDate 00:00, toDate+1 00:00) maps to a
    // UTC window via istWallClockToInstant — NOT plain UTC midnight (that was the H-3 bug).
    const bookedResult = await this.db.query(
      `SELECT ca.scheduled_at
       FROM consultation_appointment ca
       JOIN consultation_request cr ON cr.request_id = ca.consultation_id
       WHERE cr.advocate_id = $1
         AND ca.scheduled_at >= $2
         AND ca.scheduled_at < $3
         AND ca.status = 'scheduled'`,
      [
        advocateId,
        istWallClockToInstant(fromDate, '00:00').toISOString(),
        istWallClockToInstant(addDays(toDate, 1), '00:00').toISOString(),
      ],
    );

    // Booked instants → IST wall-clock keys, the SAME key space the slots are generated in.
    const bookedSet = new Set<string>(
      bookedResult.rows.map((r) => instantToIstKey(new Date(r.scheduled_at))),
    );

    const nowKey = nowIstKey(); // IST "now" — past-slot filter must compare in IST

    // Build result: iterate each IST day in range
    const results: { date: string; slots: { time: string; available: boolean }[] }[] = [];
    let current = fromDate;

    while (current <= toDate) {
      const dayOfWeek = dateStrToDayOfWeek(current);
      const dayRows = gridResult.rows.filter((r) => r.day_of_week === dayOfWeek);
      const slots: { time: string; available: boolean }[] = [];

      for (const row of dayRows) {
        const generated = generateDaySlotKeys(
          current,
          row.start_time,
          row.end_time,
          row.slot_duration_minutes,
        );
        for (const slotKey of generated) {
          if (slotKey <= nowKey) continue; // skip past slots (IST vs IST)
          const time = slotKey.substring(11, 16); // "HH:MM"
          slots.push({ time, available: !bookedSet.has(slotKey) });
        }
      }

      if (slots.length > 0) {
        results.push({ date: current, slots });
      }

      current = addDays(current, 1);
    }

    return results;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async getAdvocateByUserId(userId: string) {
    const result = await this.db.query(
      `SELECT id FROM advocates WHERE user_id = $1`,
      [userId],
    );
    if (!result.rows.length) throw new NotFoundException('Advocate profile not found');
    return result.rows[0];
  }

  private isValidTime(t: string): boolean {
    return /^\d{2}:\d{2}$/.test(t);
  }
}
