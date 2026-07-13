import type { RelayEndpoint } from '../types.js';
import type { RelayRouter } from '../router/relay-router.js';
import {
  detectRelayHopProtocol,
  type RelayHopProtocol,
} from '../resilience/stripe-put-concurrency.js';

export interface FetchUploadClientOptions {
  fetch?: typeof fetch;
  rejectNonOk?: boolean;
}

export class FetchUploadClient {
  private readonly fetchFn: typeof fetch;
  private readonly rejectNonOk: boolean;

  constructor(options: FetchUploadClientOptions = {}) {
    this.fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.rejectNonOk = options.rejectNonOk ?? true;
  }

  async put(endpoint: RelayEndpoint, body: Uint8Array): Promise<void> {
    const response = await this.fetchFn(endpoint.url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
        ...endpoint.headers,
      },
      body: body as BodyInit,
    });

    if (this.rejectNonOk && !response.ok) {
      throw new Error(`PUT ${endpoint.url} failed: HTTP ${response.status}`);
    }
  }

  async probeHopProtocol(sampleUrl: string): Promise<RelayHopProtocol> {
    return detectRelayHopProtocol(sampleUrl, this.fetchFn);
  }

  async putViaRouter(
    router: RelayRouter,
    token: string,
    body: Uint8Array,
  ): Promise<void> {
    await this.put(await router.resolve(token), body);
  }
}
