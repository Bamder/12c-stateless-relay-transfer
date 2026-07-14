import type { FetchUploadClient } from '../transport/fetch-upload-client.js';
import type { RelayEndpoint } from '../types.js';
import type { ByteTransferProgressListener } from '../transport/byte-transfer-progress.js';
import { backoffDelayMs, sleep, type RetryPolicy } from './retry-policy.js';

export interface PutRetryPolicy extends RetryPolicy {
  /** 网络瞬时失败（Failed to fetch 等）的最大尝试次数，默认 8 */
  transientMaxAttempts?: number;
}

export class PutRetryExhaustedError extends Error {
  constructor(
    readonly attempts: number,
    readonly cause: unknown,
  ) {
    const detail = formatPutCauseMessage(cause);
    super(detail !== undefined ? detail : 'PUT retries exhausted');
    this.name = 'PutRetryExhaustedError';
  }
}

function formatPutCauseMessage(cause: unknown): string | undefined {
  if (cause instanceof Error && cause.message.trim().length > 0) {
    return cause.message;
  }
  if (typeof cause === 'string' && cause.trim().length > 0) {
    return cause;
  }
  return undefined;
}

function readHttpStatusFromMessage(message: string): number | undefined {
  const match = message.match(/HTTP (\d{3})/);
  if (match === null) {
    return undefined;
  }
  const status = Number(match[1]);
  return Number.isFinite(status) ? status : undefined;
}

/** 是否值得继续重试（网络抖动、5xx、408/429）。4xx 除 408/429 外立即失败。 */
export function isTransientPutFailure(error: unknown): boolean {
  if (error instanceof TypeError) {
    return true;
  }
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message;
  if (
    /Failed to fetch|NetworkError|Load failed|network|timed out|timeout|aborted/i.test(
      message,
    )
  ) {
    return true;
  }

  const status = readHttpStatusFromMessage(message);
  if (status === undefined) {
    return false;
  }
  return status === 408 || status === 429 || status >= 500;
}

export async function putWithRetry(
  uploadClient: FetchUploadClient,
  endpoint: RelayEndpoint,
  blob: Uint8Array,
  policy: PutRetryPolicy,
  options: {
    onUploadProgress?: ByteTransferProgressListener;
  } = {},
): Promise<void> {
  if (policy.maxAttempts <= 0) {
    throw new Error('maxAttempts must be greater than zero');
  }

  const transientMaxAttempts =
    policy.transientMaxAttempts ?? DEFAULT_PUT_TRANSIENT_MAX_ATTEMPTS;

  let lastError: unknown;
  let attempt = 0;
  while (true) {
    attempt++;
    try {
      await uploadClient.put(endpoint, blob, {
        onUploadProgress: options.onUploadProgress,
      });
      return;
    } catch (error) {
      lastError = error;
      const limit = isTransientPutFailure(error)
        ? transientMaxAttempts
        : policy.maxAttempts;
      if (attempt >= limit) {
        break;
      }
      await sleep(backoffDelayMs(policy.baseDelayMs, attempt));
    }
  }

  throw new PutRetryExhaustedError(attempt, lastError);
}

export const DEFAULT_PUT_TRANSIENT_MAX_ATTEMPTS = 8;
