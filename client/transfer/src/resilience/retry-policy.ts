export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
}

export function backoffDelayMs(baseDelayMs: number, attempt: number): number {
  return baseDelayMs * 2 ** (attempt - 1);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
