export interface PacerOptions {
  readonly ipIntervalMs: number;
  readonly accountIntervalMs: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class RequestPacer {
  private lastIpRequest = Number.NEGATIVE_INFINITY;
  private readonly lastAccountRequest = new Map<string, number>();
  private readonly accountPenaltyUntil = new Map<string, number>();
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: PacerOptions) {
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? defaultSleep;
  }

  penalize(account: string, backoffMs: number): void {
    const until = this.now() + backoffMs;
    const current = this.accountPenaltyUntil.get(account) ?? Number.NEGATIVE_INFINITY;
    if (until > current) this.accountPenaltyUntil.set(account, until);
  }

  nextAllowedAt(account: string): number {
    return Math.max(
      this.lastIpRequest + this.options.ipIntervalMs,
      (this.lastAccountRequest.get(account) ?? Number.NEGATIVE_INFINITY) + this.options.accountIntervalMs,
      this.accountPenaltyUntil.get(account) ?? Number.NEGATIVE_INFINITY,
    );
  }

  async acquire(account: string): Promise<void> {
    while (true) {
      const current = this.now();
      const allowedAt = this.nextAllowedAt(account);
      if (allowedAt <= current) {
        this.lastIpRequest = current;
        this.lastAccountRequest.set(account, current);
        return;
      }
      await this.sleep(allowedAt - current);
    }
  }
}
