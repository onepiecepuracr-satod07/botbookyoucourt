import { describe, expect, test } from 'bun:test';
import { addDays, formatIso, ictInstantToday, ictToday, parseIso, weekdayOf } from './ict.js';

describe('ictToday', () => {
  test('shifts UTC instant into ICT (+7) date', () => {
    expect(ictToday(new Date('2026-07-20T18:00:00Z'))).toEqual({ year: 2026, month: 7, day: 21 });
    expect(ictToday(new Date('2026-07-20T16:59:00Z'))).toEqual({ year: 2026, month: 7, day: 20 });
  });
});

describe('addDays', () => {
  test('crosses month boundary', () => {
    expect(addDays({ year: 2026, month: 7, day: 28 }, 7)).toEqual({ year: 2026, month: 8, day: 4 });
  });
});

describe('weekdayOf', () => {
  test('maps a known date', () => {
    expect(weekdayOf({ year: 2026, month: 7, day: 20 })).toBe('mon');
  });
});

describe('formatIso / parseIso', () => {
  test('round-trip', () => {
    const date = { year: 2026, month: 1, day: 5 };
    expect(formatIso(date)).toBe('2026-01-05');
    expect(parseIso('2026-01-05')).toEqual(date);
  });

  test('parseIso rejects garbage', () => {
    expect(() => parseIso('nope')).toThrow();
  });
});

describe('ictInstantToday', () => {
  test('resolves ICT wall-clock to the correct UTC instant', () => {
    const instant = ictInstantToday({ year: 2026, month: 7, day: 20 }, '07:00:00');
    expect(instant.toISOString()).toBe('2026-07-20T00:00:00.000Z');
  });
});
