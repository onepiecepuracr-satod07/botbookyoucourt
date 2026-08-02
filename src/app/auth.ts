import { log } from '../adapters/logger.js';
import type { BookingGateway } from '../core/ports.js';
import { withRetry } from '../core/retry.js';
import type { Credentials } from '../core/types.js';

export type GatewayFactory = (name: string, requestTimeoutMs: number) => BookingGateway;

export interface AuthFailure {
  readonly name: string;
  readonly reason: string;
}

export interface AuthOutcome {
  readonly clients: Map<string, BookingGateway>;
  readonly failed: readonly AuthFailure[];
}

export interface AuthOptions {
  readonly requestTimeoutMs: number;
  readonly attempts: number;
  readonly baseDelayMs: number;
}

async function authenticateOne(
  creds: Credentials,
  factory: GatewayFactory,
  opts: AuthOptions,
): Promise<BookingGateway> {
  const client = factory(creds.name, opts.requestTimeoutMs);
  await withRetry(() => client.authenticate(creds.username, creds.password), {
    attempts: opts.attempts,
    baseDelayMs: opts.baseDelayMs,
    onRetry: (attempt, error) =>
      log.warn(`auth ${creds.name} attempt ${attempt} failed, retrying: ${errorMessage(error)}`),
  });
  return client;
}

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export async function authenticateAll(
  credentials: readonly Credentials[],
  factory: GatewayFactory,
  opts: AuthOptions,
): Promise<Map<string, BookingGateway>> {
  const clients = new Map<string, BookingGateway>();
  await Promise.all(
    credentials.map(async (creds) => {
      clients.set(creds.name, await authenticateOne(creds, factory, opts));
      log.info(`authenticated ${creds.name}`);
    }),
  );
  return clients;
}

export async function authenticateAvailable(
  credentials: readonly Credentials[],
  factory: GatewayFactory,
  opts: AuthOptions,
): Promise<AuthOutcome> {
  const clients = new Map<string, BookingGateway>();
  const failed: AuthFailure[] = [];
  const settled = await Promise.allSettled(credentials.map((creds) => authenticateOne(creds, factory, opts)));
  settled.forEach((outcome, index) => {
    const creds = credentials[index];
    if (!creds) return;
    if (outcome.status === 'fulfilled') {
      clients.set(creds.name, outcome.value);
      log.info(`authenticated ${creds.name}`);
    } else {
      const reason = errorMessage(outcome.reason);
      failed.push({ name: creds.name, reason });
      log.error(`auth ${creds.name} failed after ${opts.attempts} attempts: ${reason}`);
    }
  });
  return { clients, failed };
}
