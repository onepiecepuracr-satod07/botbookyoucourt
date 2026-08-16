import { log } from '../adapters/logger.js';
import { AbpError, isCourtClosedError, isRateLimitError } from '../core/errors.js';
import { formatIso, type IctDate } from '../core/ict.js';
import { RequestPacer } from '../core/pacer.js';
import type { BookingTask } from '../core/planner.js';
import type { BookingGateway } from '../core/ports.js';
import { courtNumberOf } from '../core/types.js';

export interface TaskResult {
  readonly targetDate: IctDate;
  readonly account: string;
  readonly hour: number;
  readonly ok: boolean;
  readonly courtNumber?: number;
  readonly bookingCode?: string;
  readonly reason?: string;
}

export interface DatePlan {
  readonly targetDate: IctDate;
  readonly tasks: readonly BookingTask[];
}

export interface RaceOptions {
  readonly deadline: Date;
  readonly accountIntervalMs: number;
  readonly ipIntervalMs: number;
  readonly rateLimitBackoffMs: number;
  readonly gatePollIntervalMs: number;
}

class SameCourtCoordinator {
  private wonCourtId: number | null = null;

  reportWin(courtId: number): void {
    this.wonCourtId ??= courtId;
  }

  reorder(priority: readonly number[]): number[] {
    if (this.wonCourtId === null || !priority.includes(this.wonCourtId)) return [...priority];
    return [this.wonCourtId, ...priority.filter((id) => id !== this.wonCourtId)];
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

class WindowGate {
  private result: Promise<boolean> | null = null;

  constructor(
    private readonly client: BookingGateway,
    private readonly targetDate: IctDate,
    private readonly todayDate: IctDate,
    private readonly pollIntervalMs: number,
    private readonly deadline: Date,
  ) {}

  wait(): Promise<boolean> {
    this.result ??= this.poll();
    return this.result;
  }

  private async poll(): Promise<boolean> {
    const label = `gate ${formatIso(this.targetDate)}`;
    const todayFlag = formatIso(this.targetDate) === formatIso(this.todayDate) ? 1 : 2;
    let attempts = 0;
    while (Date.now() < this.deadline.getTime()) {
      attempts += 1;
      try {
        const rows = await this.client.listCourts(this.targetDate, todayFlag);
        if (rows.length > 0) {
          log.info(`${label} OPEN after ${attempts} poll(s) — ${rows.length} courts listed`);
          return true;
        }
        if (attempts === 1 || attempts % 15 === 0) {
          log.info(`${label} not open yet (0 courts listed, poll #${attempts})`);
        }
      } catch (error) {
        log.warn(`${label} listCourts failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      await sleep(this.pollIntervalMs);
    }
    log.error(`${label} never opened before deadline`);
    return false;
  }
}

async function runTask(
  client: BookingGateway,
  task: BookingTask,
  targetDate: IctDate,
  todayDate: IctDate,
  gate: WindowGate,
  coordinator: SameCourtCoordinator,
  pacer: RequestPacer,
  options: RaceOptions,
): Promise<TaskResult> {
  const label = `${task.credentials.name}@${formatIso(targetDate)} ${task.hour}:00`;
  const fail = (reason: string): TaskResult => {
    const result: TaskResult = {
      targetDate,
      account: task.credentials.name,
      hour: task.hour,
      ok: false,
      reason,
    };
    log.error(`${label} FAILED`, result);
    return result;
  };

  if (!(await gate.wait())) {
    return fail(`booking window for ${formatIso(targetDate)} never opened before deadline`);
  }

  let remainingCourts = [...task.courtPriority];
  let cursor = 0;
  let lastError = 'no attempt made';

  while (Date.now() < options.deadline.getTime()) {
    if (remainingCourts.length === 0) {
      return fail(`all courts closed for ${formatIso(targetDate)} — last error: ${lastError}`);
    }
    await pacer.acquire(task.credentials.name);
    if (Date.now() >= options.deadline.getTime()) break;

    const ordered = coordinator.reorder(remainingCourts);
    const courtId = ordered[cursor % ordered.length] as number;
    cursor += 1;

    try {
      const bookingId = await client.createBooking(targetDate, todayDate, task.hour, courtId);
      coordinator.reportWin(courtId);
      const view = await client.getBooking(bookingId);
      const result: TaskResult = {
        targetDate,
        account: task.credentials.name,
        hour: task.hour,
        ok: true,
        courtNumber: courtNumberOf(courtId),
        bookingCode: view.booking.bookingCode,
      };
      log.info(`${label} BOOKED`, result);
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (error instanceof AbpError && error.unAuthorizedRequest) {
        log.warn(`${label} token rejected, re-authenticating`);
        await client.authenticate(task.credentials.username, task.credentials.password);
      } else if (isRateLimitError(error)) {
        pacer.penalize(task.credentials.name, options.rateLimitBackoffMs);
        log.warn(`${label} rate-limited, backing off ${options.rateLimitBackoffMs}ms: ${lastError}`);
      } else if (isCourtClosedError(error)) {
        remainingCourts = remainingCourts.filter((id) => id !== courtId);
        log.warn(
          `${label} court ${courtNumberOf(courtId)} closed for this date, dropped from rotation: ${lastError}`,
        );
      } else {
        log.warn(`${label} court ${courtNumberOf(courtId)} failed: ${lastError}`);
      }
    }
  }

  return fail(lastError);
}

export async function executeRace(
  clients: ReadonlyMap<string, BookingGateway>,
  plans: readonly DatePlan[],
  todayDate: IctDate,
  options: RaceOptions,
): Promise<TaskResult[]> {
  const gateClient = clients.values().next().value;
  if (!gateClient) throw new Error('no authenticated client available');
  const pacer = new RequestPacer({
    ipIntervalMs: options.ipIntervalMs,
    accountIntervalMs: options.accountIntervalMs,
  });

  const runs: Promise<TaskResult>[] = [];
  for (const plan of plans) {
    const gate = new WindowGate(
      gateClient,
      plan.targetDate,
      todayDate,
      options.gatePollIntervalMs,
      options.deadline,
    );
    const coordinator = new SameCourtCoordinator();
    for (const task of plan.tasks) {
      const client = clients.get(task.credentials.name);
      if (!client) throw new Error(`no client for account "${task.credentials.name}"`);
      runs.push(runTask(client, task, plan.targetDate, todayDate, gate, coordinator, pacer, options));
    }
  }
  log.info(`executing ${runs.length} booking task(s) across ${plans.length} date(s)`);
  return Promise.all(runs);
}
