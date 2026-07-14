import type { RelayEndpoint } from '../types.js';
import type { RelayRouter } from '../router/relay-router.js';
import {
  detectRelayHopProtocol,
  type RelayHopProtocol,
} from '../resilience/stripe-put-concurrency.js';
import type { ByteTransferProgressListener } from './byte-transfer-progress.js';
import { createThrottledProgressListener } from './byte-transfer-progress.js';
import { putWireBlockBody } from './put-wire-block-body.js';

export interface FetchUploadClientOptions {
  fetch?: typeof fetch;
  rejectNonOk?: boolean;
  /** Force legacy fetch PUT instead of XHR+progress. */
  forceFetchPutFallback?: boolean;
}

export interface PutWireBlockOptions {
  onUploadProgress?: ByteTransferProgressListener;
  signal?: AbortSignal;
}

export class FetchUploadClient {
  private readonly fetchFn: typeof fetch;
  private readonly rejectNonOk: boolean;
  private readonly forceFetchPutFallback: boolean;

  constructor(options: FetchUploadClientOptions = {}) {
    this.fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.rejectNonOk = options.rejectNonOk ?? true;
    this.forceFetchPutFallback = options.forceFetchPutFallback === true;
  }

  async put(
    endpoint: RelayEndpoint,
    body: Uint8Array,
    options: PutWireBlockOptions = {},
  ): Promise<void> {
    await putWireBlockBody(endpoint.url, body, {
      headers: endpoint.headers,
      rejectNonOk: this.rejectNonOk,
      fetchFn: this.fetchFn,
      forceFetchPutFallback: this.forceFetchPutFallback,
      signal: options.signal,
      onUploadProgress: createThrottledProgressListener(options.onUploadProgress),
    });
  }

  async probeHopProtocol(sampleUrl: string): Promise<RelayHopProtocol> {
    return detectRelayHopProtocol(sampleUrl, this.fetchFn);
  }

  async putViaRouter(
    router: RelayRouter,
    token: string,
    body: Uint8Array,
    options: PutWireBlockOptions = {},
  ): Promise<void> {
    await this.put(await router.resolve(token), body, options);
  }
}
