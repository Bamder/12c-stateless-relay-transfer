import type { RelayEndpoint } from '../types.js';
import type { ByteTransferProgressListener } from '../transport/byte-transfer-progress.js';
import { createThrottledProgressListener } from '../transport/byte-transfer-progress.js';
import { readResponseBody } from '../transport/get-response-body.js';

export interface GetWithFallbacksOptions {
  fetchFn: typeof fetch;
  rejectNonOk: boolean;
  signal?: AbortSignal;
  onDownloadProgress?: ByteTransferProgressListener;
  /** Fallback expected size when Content-Length is absent. */
  expectedBytesTotal?: number;
  /** Force legacy response.arrayBuffer() instead of streaming read. */
  forceArrayBufferFallback?: boolean;
}

export async function getWithFallbacks(
  token: string,
  endpoint: RelayEndpoint,
  options: GetWithFallbacksOptions,
): Promise<Uint8Array> {
  const candidates = [endpoint, ...(endpoint.fallbacks ?? [])];
  let lastError: unknown;
  const onDownloadProgress = createThrottledProgressListener(
    options.onDownloadProgress,
  );

  for (const candidate of candidates) {
    try {
      const response = await options.fetchFn(candidate.url, {
        method: 'GET',
        headers: candidate.headers ?? endpoint.headers,
        signal: options.signal,
      });

      if (options.rejectNonOk && !response.ok) {
        throw new Error(`GET ${token} failed: HTTP ${response.status}`);
      }

      return await readResponseBody(response, {
        onDownloadProgress,
        expectedBytesTotal: options.expectedBytesTotal,
        forceArrayBufferFallback: options.forceArrayBufferFallback,
      });
    } catch (error) {
      if (options.signal?.aborted) {
        throw error;
      }
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`GET ${token} failed on all targets`);
}
