/**
 * Read a GET response body with optional download byte progress.
 *
 * - Preferred: {@link readResponseBodyStreamingWithProgress}
 * - Fallback: {@link readResponseBodyViaArrayBufferFallback} (legacy arrayBuffer())
 */

import type { ByteTransferProgressListener } from './byte-transfer-progress.js';

export interface ReadResponseBodyOptions {
  onDownloadProgress?: ByteTransferProgressListener;
  /** Used when Content-Length is missing (e.g. known wire block size). */
  expectedBytesTotal?: number;
}

export function canUseStreamingResponseBody(response: Response): boolean {
  return (
    response.body !== null &&
    typeof response.body.getReader === 'function'
  );
}

function resolveExpectedTotal(
  response: Response,
  expectedBytesTotal: number | undefined,
): number | undefined {
  const header = response.headers.get('Content-Length');
  if (header !== null) {
    const parsed = Number(header);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.trunc(parsed);
    }
  }
  if (
    expectedBytesTotal !== undefined &&
    Number.isFinite(expectedBytesTotal) &&
    expectedBytesTotal >= 0
  ) {
    return Math.trunc(expectedBytesTotal);
  }
  return undefined;
}

/** Streaming body read with progressive byte totals (preferred). */
export async function readResponseBodyStreamingWithProgress(
  response: Response,
  options: ReadResponseBodyOptions = {},
): Promise<Uint8Array> {
  const body = response.body;
  if (body === null) {
    throw new Error('response body is null; cannot stream');
  }

  const reader = body.getReader();
  const expectedTotal = resolveExpectedTotal(response, options.expectedBytesTotal);
  const chunks: Uint8Array[] = [];
  let transferred = 0;

  options.onDownloadProgress?.({
    bytesTransferred: 0,
    bytesTotal: expectedTotal,
  });

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value !== undefined && value.byteLength > 0) {
      chunks.push(value);
      transferred += value.byteLength;
      options.onDownloadProgress?.({
        bytesTransferred: transferred,
        bytesTotal: expectedTotal,
      });
    }
  }

  const output = new Uint8Array(transferred);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }

  options.onDownloadProgress?.({
    bytesTransferred: output.byteLength,
    bytesTotal: expectedTotal ?? output.byteLength,
  });

  return output;
}

/** Legacy arrayBuffer() read (fallback; progress only jumps 0 → complete). */
export async function readResponseBodyViaArrayBufferFallback(
  response: Response,
  options: ReadResponseBodyOptions = {},
): Promise<Uint8Array> {
  const expectedTotal = resolveExpectedTotal(response, options.expectedBytesTotal);
  options.onDownloadProgress?.({
    bytesTransferred: 0,
    bytesTotal: expectedTotal,
  });

  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  options.onDownloadProgress?.({
    bytesTransferred: bytes.byteLength,
    bytesTotal: expectedTotal ?? bytes.byteLength,
  });
  return bytes;
}

/**
 * Read response bytes: streaming+progress when possible, else arrayBuffer fallback.
 */
export async function readResponseBody(
  response: Response,
  options: ReadResponseBodyOptions & {
    /** Force legacy arrayBuffer path even when streaming exists. */
    forceArrayBufferFallback?: boolean;
  } = {},
): Promise<Uint8Array> {
  if (
    !options.forceArrayBufferFallback &&
    canUseStreamingResponseBody(response)
  ) {
    return readResponseBodyStreamingWithProgress(response, options);
  }
  return readResponseBodyViaArrayBufferFallback(response, options);
}
