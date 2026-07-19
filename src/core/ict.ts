const ICT_OFFSET_MS = 7 * 3600_000;

export interface IctDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

export type Weekday = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';

const WEEKDAYS: readonly Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export function ictToday(now: Date = new Date()): IctDate {
  const shifted = new Date(now.getTime() + ICT_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

export function addDays(date: IctDate, days: number): IctDate {
  const ms = Date.UTC(date.year, date.month - 1, date.day) + days * 86_400_000;
  const d = new Date(ms);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export function weekdayOf(date: IctDate): Weekday {
  const day = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
  const weekday = WEEKDAYS[day];
  if (!weekday) throw new Error(`invalid weekday index ${day}`);
  return weekday;
}

export function ictMidnightUtcInstant(date: IctDate): Date {
  return new Date(Date.UTC(date.year, date.month - 1, date.day) - ICT_OFFSET_MS);
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

export function formatIso(date: IctDate): string {
  return `${date.year}-${pad(date.month)}-${pad(date.day)}`;
}

export function parseIso(value: string): IctDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`invalid date "${value}", expected YYYY-MM-DD`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export function bookingDateBody(date: IctDate): string {
  const utc = ictMidnightUtcInstant(date);
  return `${utc.getUTCFullYear()}/${pad(utc.getUTCMonth() + 1)}/${pad(utc.getUTCDate())} ${pad(utc.getUTCHours())}:${pad(utc.getUTCMinutes())}:${pad(utc.getUTCSeconds())}`;
}

export function bookingCreationTimeBody(today: IctDate): string {
  return ictMidnightUtcInstant(today).toISOString().replace('Z', '+00:00');
}

export function bookingDateQuery(date: IctDate): string {
  return `${date.month}/${date.day}/${date.year}, 12:00:00 AM`;
}

export function ictInstantToday(date: IctDate, hms: string): Date {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(hms);
  if (!match) throw new Error(`invalid time "${hms}", expected HH:mm[:ss]`);
  const ms =
    Date.UTC(date.year, date.month - 1, date.day) -
    ICT_OFFSET_MS +
    Number(match[1]) * 3600_000 +
    Number(match[2]) * 60_000 +
    Number(match[3] ?? 0) * 1000;
  return new Date(ms);
}
