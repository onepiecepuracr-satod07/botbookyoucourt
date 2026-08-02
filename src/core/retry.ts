export interface RetryOptions {
  readonly attempts: number;
  readonly baseDelayMs: number;
  readonly onRetry?: (attempt: number, error: unknown) => void;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  let lastError: unknown = new Error('withRetry called with attempts < 1');
  for (let attempt = 1; attempt <= opts.attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < opts.attempts) {
        opts.onRetry?.(attempt, error);
        await sleep(opts.baseDelayMs * attempt);
      }
    }
  }
  throw lastError;
}
