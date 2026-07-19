import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BookYourCourtClient } from './api.js';
import { COURT_IDS, loadConfig, loadCredentials, type Config, type Credentials } from './config.js';
import { executePlan } from './executor.js';
import {
  formatIso,
  ictInstantToday,
  ictToday,
  parseIso,
  type IctDate,
} from './ict.js';
import { log } from './logger.js';
import { buildPlan, type Plan } from './planner.js';
import { notifyTelegram } from './telegram.js';

function loadDotEnv(path: string): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && match[1] && process.env[match[1]] === undefined) {
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
  const args: CliArgs = { command, now: false, date: null, account: null, code: null, hour: null, court: null };
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

async function authenticateAll(credentials: readonly Credentials[]): Promise<Map<string, BookYourCourtClient>> {
  const clients = new Map<string, BookYourCourtClient>();
  await Promise.all(
    credentials.map(async (creds) => {
      const client = new BookYourCourtClient(creds.name);
      await client.authenticate(creds.username, creds.password);
      log.info(`authenticated ${creds.name}`);
      clients.set(creds.name, client);
    }),
  );
  return clients;
}

function resolvePlan(config: Config, credentials: readonly Credentials[], dateOverride: IctDate | null): Plan | null {
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
    (t) => `  ${t.credentials.name} → ${formatIso(plan.targetDate)} ${t.hour}:00-${t.hour + 1}:00, courts ${t.courtPriority.join(' > ')}`,
  );
  return lines.join('\n');
}

async function commandRun(config: Config, args: CliArgs): Promise<void> {
  const credentials = loadCredentials(config, log.warn);
  const plan = resolvePlan(config, credentials, args.date);
  const today = ictToday();
  if (!plan || plan.tasks.length === 0) {
    log.info(`no schedule entry for target day (today ${formatIso(today)} +7) — exiting`);
    return;
  }
  log.info(`plan:\n${describePlan(plan)}`);

  const clients = await authenticateAll(credentials);

  if (!args.now) {
    const fireAt = ictInstantToday(today, config.race.fireAt);
    const waitMs = fireAt.getTime() - Date.now();
    if (waitMs > 0) {
      log.info(`waiting ${(waitMs / 1000).toFixed(1)}s until fireAt ${config.race.fireAt} ICT`);
      await sleep(waitMs);
    }
  }

  const deadline = args.now
    ? new Date(Date.now() + 60_000)
    : ictInstantToday(today, config.race.deadline);

  const results = await executePlan(
    clients,
    plan.tasks,
    plan.targetDate,
    today,
    deadline,
    config.race.retryDelayMs,
  );

  const summary = results
    .map((r) =>
      r.ok
        ? `✅ ${r.account} ${r.hour}:00 court ${r.courtNumber} (${r.bookingCode})`
        : `❌ ${r.account} ${r.hour}:00 — ${r.reason}`,
    )
    .join('\n');
  const header = `🎾 BookYourCourt ${formatIso(plan.targetDate)}`;
  log.info(`results:\n${summary}`);
  await notifyTelegram(config.notify.telegram, `${header}\n${summary}`);

  if (results.some((r) => !r.ok)) process.exitCode = 1;
}

async function commandDryRun(config: Config, args: CliArgs): Promise<void> {
  const credentials = loadCredentials(config, log.warn);
  const plan = resolvePlan(config, credentials, args.date);
  if (!plan) {
    log.info('no schedule entry for target day — nothing to do');
    return;
  }
  log.info(`DRY RUN — would execute:\n${describePlan(plan)}`);
  const clients = await authenticateAll(credentials);
  await printAvailability(clients, plan.targetDate);
}

async function commandStatus(config: Config, args: CliArgs): Promise<void> {
  const credentials = loadCredentials(config, log.warn).slice(0, 1);
  const clients = await authenticateAll(credentials);
  const target = args.date ?? ictToday();
  await printAvailability(clients, target);
}

async function printAvailability(clients: ReadonlyMap<string, BookYourCourtClient>, date: IctDate): Promise<void> {
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
  const clients = await authenticateAll([creds]);
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
  await notifyTelegram(
    config.notify.telegram,
    `🎾 booked ${formatIso(args.date)} ${args.hour}:00 ${view.courtCourtName} (${view.booking.bookingCode})`,
  );
}

async function commandCancel(config: Config, args: CliArgs): Promise<void> {
  if (!args.account || !args.code) {
    throw new Error('usage: cancel --account <name> --code <bookingCode>');
  }
  const credentials = loadCredentials(config, log.warn).filter((c) => c.name === args.account);
  if (credentials.length === 0) throw new Error(`unknown account "${args.account}"`);
  const clients = await authenticateAll(credentials);
  const client = clients.get(args.account);
  if (!client) throw new Error(`no client for "${args.account}"`);
  const ok = await client.cancelBooking(args.code);
  log.info(`cancel ${args.code}: ${ok}`);
  await notifyTelegram(config.notify.telegram, `🎾 cancelled ${args.code} (${args.account}): ${ok}`);
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
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  log.error(`fatal: ${message}`);
  try {
    const config = loadConfig(join(process.cwd(), 'config.json'));
    await notifyTelegram(config.notify.telegram, `🎾❌ bot crashed: ${error instanceof Error ? error.message : String(error)}`);
  } catch {
    log.error('failed to send crash notification');
  }
  process.exit(1);
});
