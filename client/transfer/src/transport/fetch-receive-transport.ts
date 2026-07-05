import { getWithFallbacks } from '../resilience/get-with-fallbacks.js';
import type { RelayEndpoint } from '../types.js';
import type { RelayRouter } from '../router/relay-router.js';
import type { ReceiveTransport } from './receive-transport.js';

interface PendingGet {
  promise: Promise<Uint8Array>;
  abort: AbortController;
}

export class FetchReceiveTransport implements ReceiveTransport {
  private readonly pending = new Map<string, PendingGet>();
  private readonly cancelledBeforeResolve = new Set<string>();
  /** 等待 registry 解析 + 写入 pending 的 in-flight 批次 */
  private readonly inflight = new Map<string, Promise<void>>();
  private readonly fetchFn: typeof fetch;
  private readonly rejectNonOk: boolean;

  constructor(
    private readonly router: RelayRouter,
    options: { fetch?: typeof fetch; rejectNonOk?: boolean } = {},
  ) {
    this.fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.rejectNonOk = options.rejectNonOk ?? true;
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
    if (this.cancelledBeforeResolve.has(token)) {
      throw new Error(`download cancelled for token: ${token}`);
    }

    await this.ensureTokensStarted([token]);

    if (this.cancelledBeforeResolve.has(token)) {
      throw new Error(`download cancelled for token: ${token}`);
    }

    const entry = this.pending.get(token);
    if (entry === undefined) {
      throw new Error(`failed to start download for token: ${token}`);
    }

    try {
      return await entry.promise;
    } finally {
      this.pending.delete(token);
      this.cancelledBeforeResolve.delete(token);
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

    const promise = getWithFallbacks(token, endpoint, {
      fetchFn: this.fetchFn,
      rejectNonOk: this.rejectNonOk,
      signal: abort.signal,
    });

    return { promise, abort };
  }
}
