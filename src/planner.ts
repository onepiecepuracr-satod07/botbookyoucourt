import {
  addDays,
  formatIso,
  ictToday,
  weekdayOf,
  type IctDate,
} from './ict.js';
import {
  expandSlotHours,
  resolveCourtPriority,
  type Config,
  type Credentials,
} from './config.js';

export interface BookingTask {
  readonly credentials: Credentials;
  readonly hour: number;
  readonly courtPriority: readonly number[];
}

export interface Plan {
  readonly targetDate: IctDate;
  readonly tasks: readonly BookingTask[];
}

export function buildPlan(
  config: Config,
  credentials: readonly Credentials[],
  today: IctDate = ictToday(),
  advanceDays = 7,
): Plan | null {
  const targetDate = addDays(today, advanceDays);
  const weekday = weekdayOf(targetDate);
  const entry = config.schedule.find((s) => s.days.includes(weekday));
  if (!entry) return null;

  const assignments: BookingTask[] = [];
  let accountIndex = 0;
  for (const slot of entry.slots) {
    const courtPriority = resolveCourtPriority(slot.courts);
    for (const hour of expandSlotHours(slot)) {
      const creds = credentials[accountIndex];
      if (!creds) {
        throw new Error(
          `plan for ${formatIso(targetDate)} needs ${accountIndex + 1} bookings but only ${credentials.length} accounts configured (1 booking per user per day)`,
        );
      }
      assignments.push({ credentials: creds, hour, courtPriority });
      accountIndex += 1;
    }
  }
  return { targetDate, tasks: assignments };
}
