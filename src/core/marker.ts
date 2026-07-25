import { z } from 'zod';
import type { BookingTask } from './planner.js';

export const bookingMarkSchema = z.object({
  account: z.string().min(1),
  hour: z.number().int().min(0).max(23),
  courtNumber: z.number().int().min(1).max(5),
  bookingCode: z.string().min(1),
});

export type BookingMark = z.infer<typeof bookingMarkSchema>;

export const bookingMarksSchema = z.array(bookingMarkSchema);

function sameSlot(mark: BookingMark, task: BookingTask): boolean {
  return mark.account === task.credentials.name && mark.hour === task.hour;
}

export function isMarked(marks: readonly BookingMark[], task: BookingTask): boolean {
  return marks.some((mark) => sameSlot(mark, task));
}

export function pendingTasks(tasks: readonly BookingTask[], marks: readonly BookingMark[]): BookingTask[] {
  return tasks.filter((task) => !isMarked(marks, task));
}

export function mergeMarks(existing: readonly BookingMark[], added: readonly BookingMark[]): BookingMark[] {
  const merged = [...existing];
  for (const mark of added) {
    if (!merged.some((m) => m.account === mark.account && m.hour === mark.hour)) {
      merged.push(mark);
    }
  }
  return merged;
}
