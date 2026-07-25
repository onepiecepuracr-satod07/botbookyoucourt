import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createFileBookingStore } from '../adapters/booking-store.js';
import { BookYourCourtClient } from '../adapters/bookyourcourt.js';
import { log } from '../adapters/logger.js';
import { createTelegramNotifier } from '../adapters/telegram.js';
import {
  type AuthOptions,
  authenticateAll,
  authenticateAvailable,
  type GatewayFactory,
} from '../app/auth.js';
import { loadConfig, loadCredentials } from '../app/config.js';
import { executePlan } from '../app/executor.js';
import { formatIso, type IctDate, ictInstantToday, ictToday, parseIso } from '../core/ict.js';
import { type BookingMark, mergeMarks, pendingTasks } from '../core/marker.js';
import { buildPlan, type Plan } from '../core/planner.js';
import type { BookingGateway } from '../core/ports.js';
import { COURT_IDS, type Config, type Credentials } from '../core/types.js';

function loadDotEnv(path: string): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match?.[1] && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2];
    }
  }
}

interface CliArgs {
  command: string;
  now: boolean;
  date: IctDate | null;
  account: string | null;
  code: string | null;
  hour: number | null;
  court: number | null;
}

function parseArgs(argv: string[]): CliArgs {
  const [command = 'run', ...rest] = argv;
  const args: CliArgs = {
    command,
    now: false,
    date: null,
    account: null,
    code: null,
    hour: null,
    court: null,
  };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--now') args.now = true;
    else if (arg === '--date') args.date = parseIso(requireValue(rest, ++i, '--date'));
    else if (arg === '--account') args.account = requireValue(rest, ++i, '--account');
    else if (arg === '--code') args.code = requireValue(rest, ++i, '--code');
    else if (arg === '--hour') args.hour = Number(requireValue(rest, ++i, '--hour'));
    else if (arg === '--court') args.court = Number(requireValue(rest, ++i, '--court'));
    else throw new Error(`unknown argument "${arg}"`);
  }
  return args;
}

function requireValue(rest: string[], index: number, flag: string): string {
  const value = rest[index];
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const gatewayFactory: GatewayFactory = (name, requestTimeoutMs) =>
  new BookYourCourtClient(name, requestTimeoutMs);

function authOptions(config: Config): AuthOptions {
  return {
    requestTimeoutMs: config.race.requestTimeoutMs,
    attempts: config.race.authAttempts,
    baseDelayMs: config.race.authRetryDelayMs,
  };
}

function resolvePlan(
  config: Config,
  credentials: readonly Credentials[],
  dateOverride: IctDate | null,
): Plan | null {
  if (dateOverride) {
    const today = ictToday();
    const diffDays = Math.round(
      (Date.UTC(dateOverride.year, dateOverride.month - 1, dateOverride.day) -
        Date.UTC(today.year, today.month - 1, today.day)) /
        86_400_000,
    );
    return buildPlan(config, credentials, today, diffDays);
  }
  return buildPlan(config, credentials);
}

function describePlan(plan: Plan): string {
  const lines = plan.tasks.map(
    (t) =>
      `  ${t.credentials.name} → ${formatIso(plan.targetDate)} ${t.hour}:00-${t.hour + 1}:00, courts ${t.courtPriority.join(' > ')}`,
  );
  return lines.join('\n');
}

async function commandRun(config: Config, args: CliArgs): Promise<void> {
  const store = createFileBookingStore(join(process.cwd(), 'state'));
  const notifier = createTelegramNotifier(config.notify.telegram);
  const credentials = loadCredentials(config, log.warn);
  const plan = resolvePlan(config, credentials, args.date);
  const today = ictToday();
  if (!plan || plan.tasks.length === 0) {
    log.info(`no schedule entry for target day (today ${formatIso(today)} +6) — exiting`);
    return;
  }

  const header = `🎾 BookYourCourt ${formatIso(plan.targetDate)}`;
  const marks = await store.load(plan.targetDate);
  const pending = pendingTasks(plan.tasks, marks);

  if (pending.length === 0) {
    const summary = marks
      .map((m) => `✅ ${m.account} ${m.hour}:00 court ${m.courtNumber} (${m.bookingCode}) [already booked]`)
      .join('\n');
    log.info(`all tasks already booked for ${formatIso(plan.targetDate)} — skipping`);
    await notifier.notify(`${header}\n${summary}`);
    return;
  }

  if (marks.length > 0) log.info(`skipping ${marks.length} already-booked task(s)`);
  log.info(`plan:\n${describePlan({ targetDate: plan.targetDate, tasks: pending })}`);

  const pendingCreds = credentials.filter((c) => pending.some((t) => t.credentials.name === c.name));
  const { clients, failed } = await authenticateAvailable(pendingCreds, gatewayFactory, authOptions(config));
  if (clients.size === 0) {
    const detail = failed.map((f) => `${f.name} (${f.reason})`).join(', ');
    throw new Error(`all account authentications failed: ${detail}`);
  }
  const bookable = pending.filter((t) => clients.has(t.credentials.name));
  if (failed.length > 0) {
    log.warn(`proceeding without ${failed.length} account(s): ${failed.map((f) => f.name).join(', ')}`);
  }

  if (!args.now) {
    const fireAt = ictInstantToday(today, config.race.fireAt);
    const waitMs = fireAt.getTime() - Date.now();
    if (waitMs > 0) {
      log.info(`waiting ${(waitMs / 1000).toFixed(1)}s until fireAt ${config.race.fireAt} ICT`);
      await sleep(waitMs);
    }
  }

  const deadline = args.now ? new Date(Date.now() + 60_000) : ictInstantToday(today, config.race.deadline);

  const results = await executePlan(
    clients,
    bookable,
    plan.targetDate,
    today,
    deadline,
    config.race.retryDelayMs,
  );

  const newMarks: BookingMark[] = [];
  for (const r of results) {
    if (r.ok && r.courtNumber !== undefined && r.bookingCode !== undefined) {
      newMarks.push({
        account: r.account,
        hour: r.hour,
        courtNumber: r.courtNumber,
        bookingCode: r.bookingCode,
      });
    }
  }
  if (newMarks.length > 0) await store.save(plan.targetDate, mergeMarks(marks, newMarks));

  const summary = [
    ...results.map((r) =>
      r.ok
        ? `✅ ${r.account} ${r.hour}:00 court ${r.courtNumber} (${r.bookingCode})`
        : `❌ ${r.account} ${r.hour}:00 — ${r.reason}`,
    ),
    ...failed.map((f) => `⚠️ ${f.name} — auth failed after retries: ${f.reason}`),
  ].join('\n');
  log.info(`results:\n${summary}`);
  await notifier.notify(`${header}\n${summary}`);

  if (results.some((r) => !r.ok) || failed.length > 0) process.exitCode = 1;
}

async function commandDryRun(config: Config, args: CliArgs): Promise<void> {
  const credentials = loadCredentials(config, log.warn);
  const plan = resolvePlan(config, credentials, args.date);
  if (!plan) {
    log.info('no schedule entry for target day — nothing to do');
    return;
  }
  log.info(`DRY RUN — would execute:\n${describePlan(plan)}`);
  const clients = await authenticateAll(credentials, gatewayFactory, authOptions(config));
  await printAvailability(clients, plan.targetDate);
}

async function commandStatus(config: Config, args: CliArgs): Promise<void> {
  const credentials = loadCredentials(config, log.warn).slice(0, 1);
  const clients = await authenticateAll(credentials, gatewayFactory, authOptions(config));
  const target = args.date ?? ictToday();
  await printAvailability(clients, target);
}

async function printAvailability(clients: ReadonlyMap<string, BookingGateway>, date: IctDate): Promise<void> {
  const client = clients.values().next().value;
  if (!client) throw new Error('no authenticated client');
  const today = ictToday();
  const isToday = formatIso(date) === formatIso(today);
  const rows = await client.listCourts(date, isToday ? 1 : 2);
  const hours = Array.from({ length: 17 }, (_, i) => i + 6);
  log.info(`availability ${formatIso(date)} (1=free, -1=taken, .=closed)`);
  log.info(`court      | ${hours.map((h) => String(h).padStart(2)).join(' ')}`);
  for (const row of rows) {
    const cells = hours.map((h) => {
      const value = row[`t${String(h).padStart(2, '0')}` as `t${number}`];
      return value === null || value === undefined ? ' .' : String(value).padStart(2);
    });
    log.info(`${row.courtName.padEnd(10)} | ${cells.join(' ')}`);
  }
}

async function commandBook(config: Config, args: CliArgs): Promise<void> {
  if (!args.date || args.hour === null || args.court === null) {
    throw new Error('usage: book --date YYYY-MM-DD --hour <6-22> --court <1-5> [--account <name>]');
  }
  const all = loadCredentials(config, log.warn);
  const credentials = args.account ? all.filter((c) => c.name === args.account) : all.slice(0, 1);
  const creds = credentials[0];
  if (!creds) throw new Error(`unknown account "${args.account ?? ''}"`);
  const courtId = COURT_IDS[args.court];
  if (courtId === undefined) throw new Error(`unknown court number ${args.court}`);
  const clients = await authenticateAll([creds], gatewayFactory, authOptions(config));
  const client = clients.get(creds.name);
  if (!client) throw new Error(`no client for "${creds.name}"`);
  const bookingId = await client.createBooking(args.date, ictToday(), args.hour, courtId);
  const view = await client.getBooking(bookingId);
  log.info('booked', {
    account: creds.name,
    date: formatIso(args.date),
    hour: args.hour,
    court: view.courtCourtName,
    bookingCode: view.booking.bookingCode,
    status: view.booking.bookingStatus,
  });
  await createTelegramNotifier(config.notify.telegram).notify(
    `🎾 booked ${formatIso(args.date)} ${args.hour}:00 ${view.courtCourtName} (${view.booking.bookingCode})`,
  );
}

async function commandCancel(config: Config, args: CliArgs): Promise<void> {
  if (!args.account || !args.code) {
    throw new Error('usage: cancel --account <name> --code <bookingCode>');
  }
  const credentials = loadCredentials(config, log.warn).filter((c) => c.name === args.account);
  if (credentials.length === 0) throw new Error(`unknown account "${args.account}"`);
  const clients = await authenticateAll(credentials, gatewayFactory, authOptions(config));
  const client = clients.get(args.account);
  if (!client) throw new Error(`no client for "${args.account}"`);
  const ok = await client.cancelBooking(args.code);
  log.info(`cancel ${args.code}: ${ok}`);
  await createTelegramNotifier(config.notify.telegram).notify(
    `🎾 cancelled ${args.code} (${args.account}): ${ok}`,
  );
}

async function main(): Promise<void> {
  loadDotEnv(join(process.cwd(), '.env'));
  const config = loadConfig(join(process.cwd(), 'config.json'));
  const args = parseArgs(process.argv.slice(2));

  switch (args.command) {
    case 'run':
      return commandRun(config, args);
    case 'dry-run':
      return commandDryRun(config, args);
    case 'status':
      return commandStatus(config, args);
    case 'book':
      return commandBook(config, args);
    case 'cancel':
      return commandCancel(config, args);
    default:
      throw new Error(`unknown command "${args.command}" (expected run | dry-run | status | book | cancel)`);
  }
}

main().catch(async (error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  log.error(`fatal: ${message}`);
  try {
    const config = loadConfig(join(process.cwd(), 'config.json'));
    await createTelegramNotifier(config.notify.telegram).notify(
      `🎾❌ bot crashed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } catch {
    log.error('failed to send crash notification');
  }
  process.exit(1);
});
