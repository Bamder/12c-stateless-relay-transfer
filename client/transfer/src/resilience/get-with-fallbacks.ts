import type { RelayEndpoint } from '../types.js';

export interface GetWithFallbacksOptions {
  fetchFn: typeof fetch;
  rejectNonOk: boolean;
  signal?: AbortSignal;
}

export async function getWithFallbacks(
  token: string,
  endpoint: RelayEndpoint,
  options: GetWithFallbacksOptions,
): Promise<Uint8Array> {
  const candidates = [endpoint, ...(endpoint.fallbacks ?? [])];
  let lastError: unknown;

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

      const buffer = await response.arrayBuffer();
      return new Uint8Array(buffer);
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
