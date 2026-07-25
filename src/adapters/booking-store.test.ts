import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IctDate } from '../core/ict.js';
import type { BookingMark } from '../core/marker.js';
import { createFileBookingStore } from './booking-store.js';

const DATE: IctDate = { year: 2026, month: 7, day: 26 };
const dir = mkdtempSync(join(tmpdir(), 'bookstore-'));

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('createFileBookingStore', () => {
  test('load returns empty when no file exists', async () => {
    const store = createFileBookingStore(join(dir, 'missing'));
    expect(await store.load(DATE)).toEqual([]);
  });

  test('save then load round-trips marks', async () => {
    const store = createFileBookingStore(join(dir, 'roundtrip'));
    const marks: BookingMark[] = [
      { account: 'aof', hour: 17, courtNumber: 5, bookingCode: 'A17' },
      { account: 'macco', hour: 18, courtNumber: 4, bookingCode: 'M18' },
    ];
    await store.save(DATE, marks);
    expect(await store.load(DATE)).toEqual(marks);
  });

  test('load rejects a corrupt marks file', async () => {
    const store = createFileBookingStore(join(dir, 'corrupt'));
    await store.save(DATE, [{ account: 'aof', hour: 17, courtNumber: 5, bookingCode: 'A17' }]);
    const badStore = createFileBookingStore(join(dir, 'corrupt'));
    await badStore.save(DATE, [{ account: 'x', hour: 99, courtNumber: 9, bookingCode: 'X' } as BookingMark]);
    await expect(badStore.load(DATE)).rejects.toThrow();
  });
});
