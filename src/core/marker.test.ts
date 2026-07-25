import { describe, expect, test } from 'bun:test';
import { type BookingMark, isMarked, mergeMarks, pendingTasks } from './marker.js';
import type { BookingTask } from './planner.js';

const task = (name: string, hour: number): BookingTask => ({
  credentials: { name, username: `${name}u`, password: `${name}p` },
  hour,
  courtPriority: [52],
});

const mark = (account: string, hour: number): BookingMark => ({
  account,
  hour,
  courtNumber: 5,
  bookingCode: `${account}${hour}`,
});

describe('isMarked', () => {
  test('matches on account and hour', () => {
    expect(isMarked([mark('aof', 17)], task('aof', 17))).toBe(true);
    expect(isMarked([mark('aof', 17)], task('aof', 18))).toBe(false);
    expect(isMarked([mark('aof', 17)], task('macco', 17))).toBe(false);
  });
});

describe('pendingTasks', () => {
  test('drops tasks already booked, keeps the rest', () => {
    const tasks = [task('aof', 17), task('macco', 18)];
    const pending = pendingTasks(tasks, [mark('aof', 17)]);
    expect(pending).toEqual([task('macco', 18)]);
  });

  test('returns all tasks when no marks exist', () => {
    const tasks = [task('aof', 17), task('macco', 18)];
    expect(pendingTasks(tasks, [])).toEqual(tasks);
  });

  test('returns empty when every task is booked', () => {
    const tasks = [task('aof', 17), task('macco', 18)];
    expect(pendingTasks(tasks, [mark('aof', 17), mark('macco', 18)])).toEqual([]);
  });
});

describe('mergeMarks', () => {
  test('appends new marks', () => {
    expect(mergeMarks([mark('aof', 17)], [mark('macco', 18)])).toEqual([mark('aof', 17), mark('macco', 18)]);
  });

  test('does not duplicate an existing account+hour', () => {
    const existing = [mark('aof', 17)];
    expect(mergeMarks(existing, [mark('aof', 17)])).toEqual(existing);
  });
});
