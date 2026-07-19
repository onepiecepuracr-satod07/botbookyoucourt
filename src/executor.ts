import { AbpError, BookYourCourtClient } from './api.js';
import { courtNumberOf } from './config.js';
import { formatIso, type IctDate } from './ict.js';
import { log } from './logger.js';
import type { BookingTask } from './planner.js';

export interface TaskResult {
  readonly account: string;
  readonly hour: number;
  readonly ok: boolean;
  readonly courtNumber?: number;
  readonly bookingCode?: string;
  readonly reason?: string;
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

async function runTask(
  client: BookYourCourtClient,
  task: BookingTask,
  targetDate: IctDate,
  todayDate: IctDate,
  deadline: Date,
  retryDelayMs: number,
  coordinator: SameCourtCoordinator,
): Promise<TaskResult> {
  const label = `${task.credentials.name}@${task.hour}:00`;
  let lastError = 'no attempt made';

  while (Date.now() < deadline.getTime()) {
    for (const courtId of coordinator.reorder(task.courtPriority)) {
      if (Date.now() >= deadline.getTime()) break;
      try {
        const bookingId = await client.createBooking(targetDate, todayDate, task.hour, courtId);
        coordinator.reportWin(courtId);
        const view = await client.getBooking(bookingId);
        const result: TaskResult = {
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
        } else {
          log.warn(`${label} court ${courtNumberOf(courtId)} failed: ${lastError}`);
        }
      }
    }
    await sleep(retryDelayMs);
  }

  const result: TaskResult = { account: task.credentials.name, hour: task.hour, ok: false, reason: lastError };
  log.error(`${label} FAILED after deadline`, result);
  return result;
}

export async function executePlan(
  clients: ReadonlyMap<string, BookYourCourtClient>,
  tasks: readonly BookingTask[],
  targetDate: IctDate,
  todayDate: IctDate,
  deadline: Date,
  retryDelayMs: number,
): Promise<TaskResult[]> {
  const coordinator = new SameCourtCoordinator();
  log.info(`executing ${tasks.length} booking tasks for ${formatIso(targetDate)}`);
  return Promise.all(
    tasks.map((task) => {
      const client = clients.get(task.credentials.name);
      if (!client) throw new Error(`no client for account "${task.credentials.name}"`);
      return runTask(client, task, targetDate, todayDate, deadline, retryDelayMs, coordinator);
    }),
  );
}
