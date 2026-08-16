import { describe, expect, test } from 'bun:test';
import { RequestPacer } from './pacer.js';

function manualClock(): { now: () => number; sleep: (ms: number) => Promise<void>; slept: number[] } {
  let current = 0;
  const slept: number[] = [];
  return {
    now: () => current,
    sleep: (ms: number): Promise<void> => {
      slept.push(ms);
      current += ms;
      return Promise.resolve();
    },
    slept,
  };
}

describe('RequestPacer', () => {
  test('first acquire per account passes immediately', async () => {
    const clock = manualClock();
    const pacer = new RequestPacer({ ipIntervalMs: 1000, accountIntervalMs: 2000, ...clock });
    await pacer.acquire('a');
    expect(clock.slept).toEqual([]);
  });

  test('same account waits accountIntervalMs between requests', async () => {
    const clock = manualClock();
    const pacer = new RequestPacer({ ipIntervalMs: 1000, accountIntervalMs: 2000, ...clock });
    await pacer.acquire('a');
    await pacer.acquire('a');
    expect(clock.slept).toEqual([2000]);
  });

  test('different accounts wait ipIntervalMs between requests', async () => {
    const clock = manualClock();
    const pacer = new RequestPacer({ ipIntervalMs: 1000, accountIntervalMs: 2000, ...clock });
    await pacer.acquire('a');
    await pacer.acquire('b');
    expect(clock.slept).toEqual([1000]);
  });

  test('penalize delays only the penalized account', async () => {
    const clock = manualClock();
    const pacer = new RequestPacer({ ipIntervalMs: 100, accountIntervalMs: 100, ...clock });
    await pacer.acquire('a');
    pacer.penalize('a', 5000);
    await pacer.acquire('b');
    expect(clock.slept).toEqual([100]);
    await pacer.acquire('a');
    expect(pacer.nextAllowedAt('a')).toBeGreaterThanOrEqual(5000);
  });

  test('penalized account waits until penalty expires', async () => {
    const clock = manualClock();
    const pacer = new RequestPacer({ ipIntervalMs: 100, accountIntervalMs: 100, ...clock });
    await pacer.acquire('a');
    pacer.penalize('a', 5000);
    await pacer.acquire('a');
    expect(clock.slept.reduce((sum, ms) => sum + ms, 0)).toBe(5000);
  });
});
