/**
 * IST time helpers — the SINGLE source of truth for timezone math (remediation Group B / F-3).
 *
 * LegalLink is an India-only product: UTC+5:30, no DST. The booking + availability
 * features both import this module so their time logic can never drift apart.
 *
 * Convention:
 *  - `advocate_availability.start_time` / `end_time` are IST wall-clock times-of-day
 *    (zone-less recurring weekly hours; stored as SQL `time`).
 *  - `consultation_appointment.scheduled_at` is a true instant (SQL `timestamptz`, UTC).
 *  - Every slot comparison key is an IST wall-clock string "YYYY-MM-DDTHH:MM".
 *    Two instants that fall on the same IST minute produce the same key.
 */

export const APP_TZ_OFFSET_MINUTES = 330; // IST = UTC+5:30
const MS_PER_MIN = 60_000;

/** UTC instant → IST wall-clock key "YYYY-MM-DDTHH:MM". */
export function instantToIstKey(instant: Date): string {
  return new Date(instant.getTime() + APP_TZ_OFFSET_MINUTES * MS_PER_MIN)
    .toISOString()
    .substring(0, 16);
}

/** IST calendar date "YYYY-MM-DD" + wall-clock "HH:MM" → the matching UTC instant. */
export function istWallClockToInstant(dateStr: string, hhmm: string): Date {
  const asIfUtcMs = new Date(`${dateStr}T${hhmm}:00.000Z`).getTime();
  return new Date(asIfUtcMs - APP_TZ_OFFSET_MINUTES * MS_PER_MIN);
}

/** Current moment as an IST wall-clock key "YYYY-MM-DDTHH:MM". */
export function nowIstKey(): string {
  return instantToIstKey(new Date());
}

/** IST "today" as "YYYY-MM-DD". */
export function istToday(): string {
  return nowIstKey().substring(0, 10);
}

/** UTC instant → IST parts: { date, time, dayOfWeek } where dayOfWeek is 0=Mon … 6=Sun. */
export function instantToIstParts(instant: Date): {
  date: string;
  time: string;
  dayOfWeek: number;
} {
  const key = instantToIstKey(instant); // "YYYY-MM-DDTHH:MM"
  const jsDay = new Date(key + ':00.000Z').getUTCDay(); // 0=Sun … 6=Sat
  return {
    date: key.substring(0, 10),
    time: key.substring(11, 16),
    dayOfWeek: (jsDay + 6) % 7, // → 0=Mon … 6=Sun (matches advocate_availability.day_of_week)
  };
}

/** Add n days to a "YYYY-MM-DD" string, returning "YYYY-MM-DD". */
export function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().substring(0, 10);
}

/** Calendar date "YYYY-MM-DD" → dayOfWeek 0=Mon … 6=Sun. */
export function dateStrToDayOfWeek(dateStr: string): number {
  const jsDay = new Date(dateStr + 'T00:00:00Z').getUTCDay();
  return (jsDay + 6) % 7;
}

/**
 * All slot keys for one availability row on a given IST date.
 * `startTime`/`endTime` may be "HH:MM" or "HH:MM:SS" (PG `time` returns the latter).
 * Returns IST wall-clock keys "YYYY-MM-DDTHH:MM".
 */
export function generateDaySlotKeys(
  dateStr: string,
  startTime: string,
  endTime: string,
  durationMinutes: number,
): string[] {
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  const endMin = eh * 60 + em;
  const keys: string[] = [];
  let min = sh * 60 + sm;
  while (min + durationMinutes <= endMin) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    keys.push(
      `${dateStr}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
    );
    min += durationMinutes;
  }
  return keys;
}
