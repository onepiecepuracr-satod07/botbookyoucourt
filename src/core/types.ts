import { z } from 'zod';

export const COURT_IDS: Readonly<Record<number, number>> = {
  1: 39,
  2: 40,
  3: 41,
  4: 51,
  5: 52,
};

export const COURT_NUMBERS = Object.keys(COURT_IDS)
  .map(Number)
  .sort((a, b) => a - b);

export const SPORT_TYPE_TENNIS = 3;
export const SPORT_STATION_TENNIS = 4;

const weekdaySchema = z.enum(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']);

const courtPrefSchema = z.union([z.literal('any'), z.number().int().min(1).max(5)]);

const slotSchema = z.object({
  time: z.string().regex(/^\d{2}:00-\d{2}:00$/, 'expected HH:00-HH:00'),
  courts: z.array(courtPrefSchema).min(1),
});

export const configSchema = z.object({
  accounts: z.array(z.object({ name: z.string().min(1), envPrefix: z.string().min(1) })).min(1),
  schedule: z
    .array(z.object({ days: z.array(weekdaySchema).min(1), slots: z.array(slotSchema).min(1) }))
    .min(1),
  advanceDaysCandidates: z.array(z.number().int().min(0).max(14)).min(1).default([5, 6]),
  race: z.object({
    fireAt: z.string().regex(/^\d{2}:\d{2}:\d{2}$/),
    deadline: z.string().regex(/^\d{2}:\d{2}:\d{2}$/),
    accountIntervalMs: z.number().int().min(50).default(2000),
    ipIntervalMs: z.number().int().min(50).default(1000),
    rateLimitBackoffMs: z.number().int().min(0).default(5000),
    gatePollIntervalMs: z.number().int().min(100).default(2000),
    requestTimeoutMs: z.number().int().min(500).default(8000),
    authAttempts: z.number().int().min(1).default(3),
    authRetryDelayMs: z.number().int().min(50).default(300),
  }),
  notify: z.object({ telegram: z.boolean() }),
});

export type Config = z.infer<typeof configSchema>;
export type SlotConfig = z.infer<typeof slotSchema>;

export interface Credentials {
  readonly name: string;
  readonly username: string;
  readonly password: string;
}

export interface CourtRow {
  courtId: number;
  courtName: string;
  bookingDate: string;
  [slot: `t${number}`]: number | null | undefined;
}

export interface BookingView {
  booking: {
    bookingCode: string;
    bookingDate: string;
    bookingTime: string;
    bookingStatus: string;
    courtId: number;
    id: number;
  };
  courtCourtName: string;
}

export function resolveCourtPriority(prefs: readonly (number | 'any')[]): number[] {
  const ordered: number[] = [];
  for (const pref of prefs) {
    if (pref === 'any') {
      for (const n of COURT_NUMBERS) if (!ordered.includes(n)) ordered.push(n);
    } else if (!ordered.includes(pref)) {
      ordered.push(pref);
    }
  }
  return ordered.map((n) => {
    const id = COURT_IDS[n];
    if (id === undefined) throw new Error(`unknown court number ${n}`);
    return id;
  });
}

export function courtNumberOf(courtId: number): number {
  const entry = Object.entries(COURT_IDS).find(([, id]) => id === courtId);
  if (!entry) throw new Error(`unknown courtId ${courtId}`);
  return Number(entry[0]);
}

export function expandSlotHours(slot: SlotConfig): number[] {
  const [startRaw, endRaw] = slot.time.split('-') as [string, string];
  const start = Number(startRaw.slice(0, 2));
  const end = Number(endRaw.slice(0, 2));
  if (end <= start) throw new Error(`invalid slot range "${slot.time}"`);
  return Array.from({ length: end - start }, (_, i) => start + i);
}
