import { describe, expect, test } from 'bun:test';
import { withRetry } from './retry.js';

describe('withRetry', () => {
  test('returns immediately on first success', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        return 'ok';
      },
      { attempts: 3, baseDelayMs: 1 },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(1);
  });

  test('retries then succeeds and reports each retry', async () => {
    let calls = 0;
    const retries: number[] = [];
    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error(`fail ${calls}`);
        return calls;
      },
      { attempts: 5, baseDelayMs: 1, onRetry: (attempt) => retries.push(attempt) },
    );
    expect(result).toBe(3);
    expect(calls).toBe(3);
    expect(retries).toEqual([1, 2]);
  });

  test('throws the last error after exhausting attempts', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new Error(`fail ${calls}`);
        },
        { attempts: 3, baseDelayMs: 1 },
      ),
    ).rejects.toThrow('fail 3');
    expect(calls).toBe(3);
  });
});
