import { describe, expect, test } from 'bun:test';
import type { BookingGateway } from '../core/ports.js';
import type { BookingView, CourtRow, Credentials } from '../core/types.js';
import { authenticateAll, authenticateAvailable, type GatewayFactory } from './auth.js';

const OPTS = { requestTimeoutMs: 1000, attempts: 3, baseDelayMs: 1 };
const creds = (name: string): Credentials => ({ name, username: `${name}u`, password: `${name}p` });

class FakeGateway implements BookingGateway {
  authCount = 0;
  constructor(
    readonly account: string,
    private readonly failTimes: number,
  ) {}

  async authenticate(): Promise<void> {
    this.authCount += 1;
    if (this.authCount <= this.failTimes) throw new Error(`auth boom ${this.account}`);
  }

  async listCourts(): Promise<CourtRow[]> {
    return [];
  }
  async createBooking(): Promise<number> {
    return 1;
  }
  async getBooking(): Promise<BookingView> {
    throw new Error('unused');
  }
  async cancelBooking(): Promise<boolean> {
    return true;
  }
}

const factoryFor = (gateways: Record<string, FakeGateway>): GatewayFactory => {
  return (name) => {
    const gw = gateways[name];
    if (!gw) throw new Error(`no fake for ${name}`);
    return gw;
  };
};

describe('authenticateAvailable', () => {
  test('keeps accounts that authenticate and reports ones that fail', async () => {
    const gws = { a: new FakeGateway('a', 0), b: new FakeGateway('b', 99) };
    const outcome = await authenticateAvailable([creds('a'), creds('b')], factoryFor(gws), OPTS);
    expect([...outcome.clients.keys()]).toEqual(['a']);
    expect(outcome.failed).toEqual([{ name: 'b', reason: 'auth boom b' }]);
  });

  test('retries a transient failure then succeeds', async () => {
    const gws = { a: new FakeGateway('a', 2) };
    const outcome = await authenticateAvailable([creds('a')], factoryFor(gws), OPTS);
    expect([...outcome.clients.keys()]).toEqual(['a']);
    expect(outcome.failed).toEqual([]);
    expect(gws.a.authCount).toBe(3);
  });

  test('returns empty clients when every account fails', async () => {
    const gws = { a: new FakeGateway('a', 99), b: new FakeGateway('b', 99) };
    const outcome = await authenticateAvailable([creds('a'), creds('b')], factoryFor(gws), OPTS);
    expect(outcome.clients.size).toBe(0);
    expect(outcome.failed.map((f) => f.name)).toEqual(['a', 'b']);
  });
});

describe('authenticateAll', () => {
  test('throws when any account fails', async () => {
    const gws = { a: new FakeGateway('a', 0), b: new FakeGateway('b', 99) };
    await expect(authenticateAll([creds('a'), creds('b')], factoryFor(gws), OPTS)).rejects.toThrow(
      'auth boom b',
    );
  });
});
