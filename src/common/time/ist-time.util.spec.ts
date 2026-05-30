import {
  APP_TZ_OFFSET_MINUTES,
  addDays,
  dateStrToDayOfWeek,
  generateDaySlotKeys,
  instantToIstKey,
  instantToIstParts,
  istWallClockToInstant,
  nowIstKey,
  istToday,
} from './ist-time.util';

describe('ist-time.util', () => {
  it('uses the IST offset (UTC+5:30)', () => {
    expect(APP_TZ_OFFSET_MINUTES).toBe(330);
  });

  describe('instantToIstKey', () => {
    it('shifts a UTC instant into its IST wall-clock minute', () => {
      // 04:30 UTC == 10:00 IST
      expect(instantToIstKey(new Date('2026-06-15T04:30:00.000Z'))).toBe(
        '2026-06-15T10:00',
      );
    });

    it('rolls the IST date forward when the UTC instant is late-evening UTC', () => {
      // 20:30 UTC on the 14th == 02:00 IST on the 15th
      expect(instantToIstKey(new Date('2026-06-14T20:30:00.000Z'))).toBe(
        '2026-06-15T02:00',
      );
    });
  });

  describe('istWallClockToInstant', () => {
    it('converts an IST wall-clock back to the correct UTC instant', () => {
      expect(istWallClockToInstant('2026-06-15', '10:00').toISOString()).toBe(
        '2026-06-15T04:30:00.000Z',
      );
    });

    it('round-trips with instantToIstKey', () => {
      const key = '2026-12-31T23:30';
      const [date, time] = key.split('T');
      expect(instantToIstKey(istWallClockToInstant(date, time))).toBe(key);
    });
  });

  describe('instantToIstParts', () => {
    it('maps a Monday IST instant to dayOfWeek 0', () => {
      // 2026-06-15 is a Monday
      const parts = instantToIstParts(new Date('2026-06-15T04:30:00.000Z'));
      expect(parts).toEqual({ date: '2026-06-15', time: '10:00', dayOfWeek: 0 });
    });

    it('maps a Sunday IST instant to dayOfWeek 6', () => {
      // 2026-06-21 is a Sunday
      const parts = instantToIstParts(new Date('2026-06-21T09:00:00.000Z'));
      expect(parts.dayOfWeek).toBe(6);
    });

    it('computes the IST date (not the UTC date) when they differ', () => {
      // 20:30 UTC Sun 14th -> 02:00 IST Mon 15th -> dayOfWeek 0
      const parts = instantToIstParts(new Date('2026-06-14T20:30:00.000Z'));
      expect(parts.date).toBe('2026-06-15');
      expect(parts.dayOfWeek).toBe(0);
    });
  });

  describe('addDays / dateStrToDayOfWeek', () => {
    it('adds days and crosses month boundaries', () => {
      expect(addDays('2026-06-29', 3)).toBe('2026-07-02');
    });

    it('maps Monday->0 and Sunday->6', () => {
      expect(dateStrToDayOfWeek('2026-06-15')).toBe(0); // Monday
      expect(dateStrToDayOfWeek('2026-06-21')).toBe(6); // Sunday
    });
  });

  describe('generateDaySlotKeys', () => {
    it('generates back-to-back 30-min slots within [start, end)', () => {
      const keys = generateDaySlotKeys('2026-06-15', '09:00', '11:00', 30);
      expect(keys).toEqual([
        '2026-06-15T09:00',
        '2026-06-15T09:30',
        '2026-06-15T10:00',
        '2026-06-15T10:30',
      ]);
    });

    it('accepts PG time "HH:MM:SS" form', () => {
      const keys = generateDaySlotKeys('2026-06-15', '09:00:00', '10:00:00', 30);
      expect(keys).toEqual(['2026-06-15T09:00', '2026-06-15T09:30']);
    });

    it('produces no slot that would overrun end_time', () => {
      // 09:00-10:00 with 60-min slots => exactly one 09:00 slot, never a 10:00 one
      expect(generateDaySlotKeys('2026-06-15', '09:00', '10:00', 60)).toEqual([
        '2026-06-15T09:00',
      ]);
    });
  });

  describe('regression: H-3 booked slot must match a generated slot', () => {
    it('a 10:00 IST booking collides with the generated 10:00 slot key', () => {
      // What the booking stores: the UTC instant for IST 10:00.
      const bookedInstant = istWallClockToInstant('2026-06-15', '10:00');
      // What the DB returns and the availability service keys it by:
      const bookedKey = instantToIstKey(bookedInstant);
      // What generateDaySlotKeys produces for the advocate's 09:00-17:00 grid:
      const slotKeys = generateDaySlotKeys('2026-06-15', '09:00', '17:00', 30);
      // The previously-buggy mismatch is now an exact hit:
      expect(slotKeys).toContain(bookedKey);
      const bookedSet = new Set([bookedKey]);
      const available = slotKeys.map((k) => ({ k, available: !bookedSet.has(k) }));
      expect(available.find((s) => s.k === '2026-06-15T10:00')!.available).toBe(false);
      // a different slot stays available
      expect(available.find((s) => s.k === '2026-06-15T11:00')!.available).toBe(true);
    });
  });

  describe('current-time helpers', () => {
    it('nowIstKey returns a YYYY-MM-DDTHH:MM string', () => {
      expect(nowIstKey()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    });

    it('istToday returns a YYYY-MM-DD string equal to nowIstKey date part', () => {
      expect(istToday()).toBe(nowIstKey().substring(0, 10));
    });
  });
});
