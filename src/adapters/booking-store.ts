import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatIso, type IctDate } from '../core/ict.js';
import { type BookingMark, bookingMarksSchema } from '../core/marker.js';
import type { BookingStore } from '../core/ports.js';

export function createFileBookingStore(dir: string): BookingStore {
  const fileFor = (date: IctDate): string => join(dir, `booked-${formatIso(date)}.json`);
  return {
    async load(targetDate: IctDate): Promise<BookingMark[]> {
      const path = fileFor(targetDate);
      if (!existsSync(path)) return [];
      return bookingMarksSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    },
    async save(targetDate: IctDate, marks: readonly BookingMark[]): Promise<void> {
      mkdirSync(dir, { recursive: true });
      writeFileSync(fileFor(targetDate), `${JSON.stringify(marks, null, 2)}\n`);
    },
  };
}
