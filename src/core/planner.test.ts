import { describe, expect, test } from 'bun:test';
import { buildPlan } from './planner.js';
import { COURT_IDS, type Config, type Credentials } from './types.js';

const creds = (name: string): Credentials => ({ name, username: `${name}u`, password: `${name}p` });

const config = (): Config => ({
  accounts: [
    { name: 'a', envPrefix: 'A' },
    { name: 'b', envPrefix: 'B' },
  ],
  schedule: [{ days: ['mon'], slots: [{ time: '18:00-20:00', courts: [3, 'any'] }] }],
  race: { fireAt: '07:00:00', deadline: '07:00:10', retryDelayMs: 100 },
  notify: { telegram: false },
});

// 2026-07-13 is a Monday; +7 -> 2026-07-20 (also Monday).
const monday = { year: 2026, month: 7, day: 13 };

describe('buildPlan', () => {
  test('assigns one account per hour with resolved court priority', () => {
    const plan = buildPlan(config(), [creds('a'), creds('b')], monday, 7);
    expect(plan).not.toBeNull();
    expect(plan?.targetDate).toEqual({ year: 2026, month: 7, day: 20 });
    expect(plan?.tasks).toHaveLength(2);
    expect(plan?.tasks[0]).toMatchObject({ hour: 18 });
    expect(plan?.tasks[1]).toMatchObject({ hour: 19 });
    expect(plan?.tasks[0]?.credentials.name).toBe('a');
    expect(plan?.tasks[1]?.credentials.name).toBe('b');
    // court 3 first, then remaining courts in order
    expect(plan?.tasks[0]?.courtPriority[0]).toBe(COURT_IDS[3]);
  });

  test('defaults to booking 6 days ahead (venue window opens +6 at 07:00)', () => {
    // monday 2026-07-13, default +6 -> 2026-07-19 (Sunday)
    const sundayConfig: Config = {
      ...config(),
      schedule: [{ days: ['sun'], slots: [{ time: '18:00-19:00', courts: [3] }] }],
    };
    const plan = buildPlan(sundayConfig, [creds('a')], monday);
    expect(plan?.targetDate).toEqual({ year: 2026, month: 7, day: 19 });
  });

  test('returns null when target weekday has no schedule entry', () => {
    // +8 -> Tuesday, not in schedule
    expect(buildPlan(config(), [creds('a'), creds('b')], monday, 8)).toBeNull();
  });

  test('throws when accounts are fewer than required bookings', () => {
    expect(() => buildPlan(config(), [creds('a')], monday, 7)).toThrow(/only 1 accounts/);
  });
});
