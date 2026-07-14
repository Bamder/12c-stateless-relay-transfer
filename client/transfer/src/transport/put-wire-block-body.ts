/**
 * PUT a wire-block body with optional upload byte progress.
 *
 * - Preferred: {@link putBodyWithUploadProgressViaXhr} (XHR upload.onprogress)
 * - Fallback: {@link putBodyViaFetchFallback} (legacy fetch PUT, no byte progress)
 */

import type { ByteTransferProgressListener } from './byte-transfer-progress.js';

export interface PutWireBlockBodyOptions {
  headers?: Record<string, string>;
  rejectNonOk?: boolean;
  signal?: AbortSignal;
  onUploadProgress?: ByteTransferProgressListener;
}

export function canUseXhrUploadProgress(): boolean {
  return typeof XMLHttpRequest !== 'undefined';
}

/** Progress-capable PUT via XMLHttpRequest (preferred when available). */
export function putBodyWithUploadProgressViaXhr(
  url: string,
  body: Uint8Array,
  options: PutWireBlockBodyOptions = {},
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);
    xhr.responseType = 'text';

    const headers = {
      'Content-Type': 'application/octet-stream',
      ...options.headers,
    };
    for (const [key, value] of Object.entries(headers)) {
      xhr.setRequestHeader(key, value);
    }

    const bytesTotal = body.byteLength;
    xhr.upload.onprogress = (event) => {
      const transferred = event.lengthComputable
        ? event.loaded
        : event.loaded;
      options.onUploadProgress?.({
        bytesTransferred: transferred,
        bytesTotal: event.lengthComputable ? event.total : bytesTotal,
      });
    };

    xhr.onload = () => {
      options.onUploadProgress?.({
        bytesTransferred: bytesTotal,
        bytesTotal,
      });
      if (options.rejectNonOk !== false && (xhr.status < 200 || xhr.status >= 300)) {
        reject(new Error(`PUT ${url} failed: HTTP ${xhr.status}`));
        return;
      }
      resolve();
    };

    xhr.onerror = () => {
      reject(new Error(`PUT ${url} failed: network error`));
    };

    xhr.onabort = () => {
      reject(new Error(`PUT ${url} failed: aborted`));
    };

    if (options.signal !== undefined) {
      if (options.signal.aborted) {
        reject(new Error(`PUT ${url} failed: aborted`));
        return;
      }
      options.signal.addEventListener(
        'abort',
        () => {
          xhr.abort();
        },
        { once: true },
      );
    }

    options.onUploadProgress?.({ bytesTransferred: 0, bytesTotal });
    xhr.send(body as XMLHttpRequestBodyInit);
  });
}

/** Legacy fetch PUT without upload byte progress (fallback). */
export async function putBodyViaFetchFallback(
  url: string,
  body: Uint8Array,
  options: PutWireBlockBodyOptions & {
    fetchFn?: typeof fetch;
  } = {},
): Promise<void> {
  const fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
  const response = await fetchFn(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/octet-stream',
      ...options.headers,
    },
    body: body as BodyInit,
    signal: options.signal,
  });

  if (options.rejectNonOk !== false && !response.ok) {
    throw new Error(`PUT ${url} failed: HTTP ${response.status}`);
  }

  const bytesTotal = body.byteLength;
  options.onUploadProgress?.({
    bytesTransferred: bytesTotal,
    bytesTotal,
  });
}

/**
 * PUT wire block: XHR+progress when available, otherwise fetch fallback.
 * HTTP failures are not silently retried on the other path.
 */
export async function putWireBlockBody(
  url: string,
  body: Uint8Array,
  options: PutWireBlockBodyOptions & {
    fetchFn?: typeof fetch;
    /** Force legacy fetch PUT even when XHR exists. */
    forceFetchPutFallback?: boolean;
  } = {},
): Promise<void> {
  if (!options.forceFetchPutFallback && canUseXhrUploadProgress()) {
    await putBodyWithUploadProgressViaXhr(url, body, options);
    return;
  }
  await putBodyViaFetchFallback(url, body, options);
}
