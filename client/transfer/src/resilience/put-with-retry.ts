import type { FetchUploadClient } from '../transport/fetch-upload-client.js';
import type { RelayEndpoint } from '../types.js';
import { backoffDelayMs, sleep, type RetryPolicy } from './retry-policy.js';

export async function putWithRetry(
  uploadClient: FetchUploadClient,
  endpoint: RelayEndpoint,
  blob: Uint8Array,
  policy: RetryPolicy,
): Promise<void> {
  if (policy.maxAttempts <= 0) {
    throw new Error('maxAttempts must be greater than zero');
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    try {
      await uploadClient.put(endpoint, blob);
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= policy.maxAttempts) {
        break;
      }
      await sleep(backoffDelayMs(policy.baseDelayMs, attempt));
    }
  }
  throw lastError;
}
