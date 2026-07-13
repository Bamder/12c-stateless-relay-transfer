import { getWithFallbacks } from '../resilience/get-with-fallbacks.js';
import { backoffDelayMs, sleep } from '../resilience/retry-policy.js';
import { TokenPlacementExpiredError } from '../router/registry-client.js';
import type { RelayEndpoint } from '../types.js';
import type { RelayRouter } from '../router/relay-router.js';
import type { ReceiveTransport } from './receive-transport.js';

interface PendingGet {
  promise: Promise<Uint8Array>;
  abort: AbortController;
}

export interface FetchReceiveTransportOptions {
  fetch?: typeof fetch;
  rejectNonOk?: boolean;
  /** Registry 尚未登记某 token 时重试 resolve 的次数。 */
  resolveMaxAttempts?: number;
  resolveRetryDelayMs?: number;
  /** Relay GET 瞬态失败（404 等）重试次数。 */
  getMaxAttempts?: number;
}

const DEFAULT_RESOLVE_MAX_ATTEMPTS = 20;
const DEFAULT_RESOLVE_RETRY_DELAY_MS = 500;
const DEFAULT_GET_MAX_ATTEMPTS = 120;
const REGISTRY_WAIT_BASE_DELAY_MS = 2000;
const WAITING_ACTIVITY_MIN_INTERVAL_MS = 3000;
const WAITING_ACTIVITY_ATTEMPT_STEP = 5;

export type ReceiveTransportActivity =
  | { kind: 'resolving'; tokenCount: number }
  | { kind: 'download_started'; token: string }
  | {
      kind: 'waiting';
      token: string;
      reason: 'registry' | 'relay';
      attempt: number;
    };

function isTransientDownloadError(error: unknown): boolean {
  if (error instanceof TokenPlacementExpiredError) {
    return false;
  }
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message;
  return (
    message.includes('HTTP 404') ||
    message.includes('HTTP 503') ||
    message.includes('HTTP 502') ||
    message.includes('HTTP 429') ||
    message.includes('failed on all targets') ||
    message.includes('fetch failed') ||
    message.includes('network')
  );
}

export class FetchReceiveTransport implements ReceiveTransport {
  private readonly pending = new Map<string, PendingGet>();
  private readonly cancelledBeforeResolve = new Set<string>();
  private readonly inflight = new Map<string, Promise<void>>();
  private readonly fetchFn: typeof fetch;
  private readonly rejectNonOk: boolean;
  private readonly resolveMaxAttempts: number;
  private readonly resolveRetryDelayMs: number;
  private readonly getMaxAttempts: number;
  private activityListener: ((activity: ReceiveTransportActivity) => void) | null =
    null;
  private readonly lastWaitingActivity = new Map<
    string,
    { attempt: number; atMs: number }
  >();

  constructor(
    private readonly router: RelayRouter,
    options: FetchReceiveTransportOptions = {},
  ) {
    this.fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.rejectNonOk = options.rejectNonOk ?? true;
    this.resolveMaxAttempts =
      options.resolveMaxAttempts ?? DEFAULT_RESOLVE_MAX_ATTEMPTS;
    this.resolveRetryDelayMs =
      options.resolveRetryDelayMs ?? DEFAULT_RESOLVE_RETRY_DELAY_MS;
    this.getMaxAttempts = options.getMaxAttempts ?? DEFAULT_GET_MAX_ATTEMPTS;
  }

  setActivityListener(
    listener: ((activity: ReceiveTransportActivity) => void) | null,
  ): void {
    this.activityListener = listener;
  }

  startConcurrentGet(tokens: string[]): void {
    void this.ensureTokensStarted(tokens);
  }

  cancelPending(tokens: string[]): void {
    for (const token of tokens) {
      this.cancelledBeforeResolve.add(token);
      const entry = this.pending.get(token);
      if (entry === undefined) {
        continue;
      }
      entry.abort.abort();
      this.pending.delete(token);
    }
  }

  async get(token: string): Promise<Uint8Array> {
    let registryAttempts = 0;
    let relayAttempts = 0;

    while (true) {
      if (this.cancelledBeforeResolve.has(token)) {
        throw new Error(`download cancelled for token: ${token}`);
      }

      try {
        await this.ensureTokensStarted([token]);
      } catch (error) {
        if (error instanceof TokenPlacementExpiredError) {
          throw error;
        }
        throw error;
      }

      if (this.cancelledBeforeResolve.has(token)) {
        throw new Error(`download cancelled for token: ${token}`);
      }

      const entry = this.pending.get(token);
      if (entry !== undefined) {
        try {
          const data = await entry.promise;
          this.pending.delete(token);
          this.cancelledBeforeResolve.delete(token);
          this.lastWaitingActivity.delete(token);
          return data;
        } catch (error) {
          this.pending.delete(token);
          if (error instanceof TokenPlacementExpiredError) {
            throw error;
          }
          if (isTransientDownloadError(error)) {
            relayAttempts++;
            if (relayAttempts >= this.getMaxAttempts) {
              throw error;
            }
            this.maybeEmitWaiting(token, 'relay', relayAttempts);
            await sleep(
              Math.min(
                5000,
                backoffDelayMs(this.resolveRetryDelayMs, relayAttempts),
              ),
            );
            continue;
          }
          throw error;
        }
      }

      registryAttempts++;
      if (registryAttempts >= this.resolveMaxAttempts) {
        throw new Error(
          `no relay endpoint resolved for token: ${token} ` +
            '(credential may be wrong, sender has not started upload, or placement expired)',
        );
      }

      this.maybeEmitWaiting(token, 'registry', registryAttempts);
      await sleep(
        Math.min(
          5000,
          backoffDelayMs(REGISTRY_WAIT_BASE_DELAY_MS, registryAttempts),
        ),
      );
    }
  }

  private ensureTokensStarted(tokens: readonly string[]): Promise<void> {
    const needed = [...new Set(tokens)].filter(
      (token) =>
        !this.pending.has(token) &&
        !this.cancelledBeforeResolve.has(token) &&
        !this.inflight.has(token),
    );

    if (needed.length > 0) {
      const batchPromise = this.resolveAndStart(needed).finally(() => {
        for (const token of needed) {
          this.inflight.delete(token);
        }
      });
      for (const token of needed) {
        this.inflight.set(token, batchPromise);
      }
    }

    const waits = tokens
      .map((token) => this.inflight.get(token))
      .filter((promise): promise is Promise<void> => promise !== undefined);

    if (waits.length === 0) {
      return Promise.resolve();
    }

    return Promise.all(waits).then(() => undefined);
  }

  private async resolveAndStart(tokens: string[]): Promise<void> {
    this.emitActivity({ kind: 'resolving', tokenCount: tokens.length });
    try {
      const endpoints = await this.router.resolveMany(tokens);
      for (const token of tokens) {
        if (this.pending.has(token) || this.cancelledBeforeResolve.has(token)) {
          continue;
        }

        const endpoint = endpoints.get(token);
        if (endpoint === undefined) {
          continue;
        }

        this.pending.set(token, this.startGet(token, endpoint));
      }
    } catch (error) {
      if (error instanceof TokenPlacementExpiredError) {
        throw error;
      }
      for (const token of tokens) {
        if (this.pending.has(token) || this.cancelledBeforeResolve.has(token)) {
          continue;
        }
        this.pending.set(token, {
          abort: new AbortController(),
          promise: Promise.reject(error),
        });
      }
    }
  }

  private startGet(token: string, endpoint: RelayEndpoint): PendingGet {
    const abort = new AbortController();
    this.emitActivity({ kind: 'download_started', token });

    const promise = getWithFallbacks(token, endpoint, {
      fetchFn: this.fetchFn,
      rejectNonOk: this.rejectNonOk,
      signal: abort.signal,
    });

    return { promise, abort };
  }

  private maybeEmitWaiting(
    token: string,
    reason: 'registry' | 'relay',
    attempt: number,
  ): void {
    const nowMs = Date.now();
    const previous = this.lastWaitingActivity.get(token);
    if (
      previous !== undefined &&
      attempt !== 1 &&
      nowMs - previous.atMs < WAITING_ACTIVITY_MIN_INTERVAL_MS &&
      attempt - previous.attempt < WAITING_ACTIVITY_ATTEMPT_STEP
    ) {
      return;
    }

    this.lastWaitingActivity.set(token, { attempt, atMs: nowMs });
    this.emitActivity({ kind: 'waiting', token, reason, attempt });
  }

  private emitActivity(activity: ReceiveTransportActivity): void {
    this.activityListener?.(activity);
  }
}
