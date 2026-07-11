import type { UploadMap } from '../types.js';
import type { RegistryClient, UploadReservationMeta } from '../router/registry-client.js';
import type { RelayRouter } from '../router/relay-router.js';
import type { FetchUploadClient } from '../transport/fetch-upload-client.js';
import type { TwelveCClient } from '../wasm/twelve-c-client.js';
import {
  collectReplicaJobs,
  resolveUploadEndpoints,
} from './upload-registry.js';
import { putWithRetry } from '../resilience/put-with-retry.js';
import { runAsyncReplicaReplication } from './replica-replication.js';
import type { UploadStatusUpdate } from './upload-status.js';

export const DEFAULT_PUT_MAX_ATTEMPTS = 3;
export const DEFAULT_PUT_RETRY_DELAY_MS = 500;
export const DEFAULT_REPLICA_PUT_MAX_ATTEMPTS = 5;
export const DEFAULT_REPLICA_PUT_RETRY_DELAY_MS = 1000;
export const DEFAULT_REPLICA_ASYNC_CONCURRENCY = 4;

export interface UploadSessionOptions {
  /** 并发 primary PUT 上限；默认不限制 */
  concurrency?: number;
  /**
   * 生产上传必传：走 reserve-tokens（token + blockHash）。
   * 省略时仅适用于 StaticRelayRouter 等离线联调。
   */
  registry?: RegistryClient;
  /** primary 单块 PUT 失败后最大尝试次数（含首次），默认 3 */
  putMaxAttempts?: number;
  /** primary 重试退避基数（毫秒），默认 500 */
  putRetryDelayMs?: number;
  /** replica 异步补传单块最大尝试次数（含首次），默认 5 */
  replicaPutMaxAttempts?: number;
  /** replica 补传退避基数（毫秒），默认 1000 */
  replicaPutRetryDelayMs?: number;
  /** replica 异步补传并发上限，默认 4 */
  replicaAsyncConcurrency?: number;
  /** 上传文件有效期（秒），传给 Registry reserve-tokens */
  ttlSeconds?: number;
}

export interface UploadProgress {
  completed: number;
  total: number;
  token: string;
}

export type { UploadStatusUpdate } from './upload-status.js';

export interface UploadPreparedResult {
  /** primary 已全部完成；replica 在后台异步补传（无 replica 时为 undefined） */
  replicaSync?: Promise<void>;
  /** Registry reserve-tokens 的 TTL / 布局分配结果 */
  reservation?: UploadReservationMeta;
}

/** reserve 已成功、primary Relay PUT 在重试耗尽后仍失败 */
export class UploadPutError extends Error {
  constructor(
    readonly token: string,
    readonly attempts: number,
    readonly cause: unknown,
  ) {
    super(`PUT failed for token ${token} after ${attempts} attempt(s)`);
    this.name = 'UploadPutError';
  }
}

/**
 * 生成 UploadMap 并上传：primary 同步完成；replica 异步补传。
 * reserve 409 由 registry 抛出；primary PUT 失败同凭证块级重试。
 */
export async function uploadPrepared(
  uploads: UploadMap,
  router: RelayRouter,
  uploadClient: FetchUploadClient,
  options: UploadSessionOptions = {},
  onProgress?: (status: UploadStatusUpdate) => void,
): Promise<UploadPreparedResult> {
  const entries = [...uploads.entries()];
  const total = entries.length;
  const concurrency = options.concurrency ?? total;
  const putMaxAttempts = options.putMaxAttempts ?? DEFAULT_PUT_MAX_ATTEMPTS;
  const putRetryDelayMs = options.putRetryDelayMs ?? DEFAULT_PUT_RETRY_DELAY_MS;

  if (total === 0) {
    return {};
  }

  if (putMaxAttempts <= 0) {
    throw new Error('putMaxAttempts must be greater than zero');
  }

  const routePlan = await resolveUploadEndpoints(uploads, router, {
    registry: options.registry,
    ttlSeconds: options.ttlSeconds,
    onStatus: onProgress,
  });

  let completed = 0;
  let inFlight = 0;
  let nextIndex = 0;

  const reportUploading = (): void => {
    onProgress?.({
      phase: 'uploading',
      completed,
      inFlight,
      total,
    });
  };

  async function worker(): Promise<void> {
    while (nextIndex < total) {
      const current = nextIndex++;
      const [token, blob] = entries[current]!;
      const endpoint = routePlan.primary.get(token);
      if (endpoint === undefined) {
        throw new Error(`no relay endpoint for token: ${token}`);
      }
      inFlight++;
      reportUploading();
      try {
        await putWithRetry(uploadClient, endpoint, blob, {
          maxAttempts: putMaxAttempts,
          baseDelayMs: putRetryDelayMs,
        });
      } catch (cause) {
        throw new UploadPutError(token, putMaxAttempts, cause);
      } finally {
        inFlight--;
      }
      completed++;
      reportUploading();
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, total) },
    () => worker(),
  );
  await Promise.all(workers);

  const registry = options.registry;
  const replicaJobs = collectReplicaJobs(uploads, routePlan);
  const reservation = routePlan.reservation;
  if (registry === undefined || replicaJobs.length === 0) {
    return reservation !== undefined ? { reservation } : {};
  }

  const replicaSync = runAsyncReplicaReplication(
    replicaJobs,
    uploadClient,
    registry,
    {
      putMaxAttempts:
        options.replicaPutMaxAttempts ?? DEFAULT_REPLICA_PUT_MAX_ATTEMPTS,
      putRetryDelayMs:
        options.replicaPutRetryDelayMs ?? DEFAULT_REPLICA_PUT_RETRY_DELAY_MS,
      concurrency:
        options.replicaAsyncConcurrency ?? DEFAULT_REPLICA_ASYNC_CONCURRENCY,
    },
  );

  return {
    replicaSync,
    ...(reservation !== undefined ? { reservation } : {}),
  };
}

export interface UploadFileResult {
  uploads: UploadMap;
  replicaSync?: Promise<void>;
  reservation?: UploadReservationMeta;
}

/**
 * 加密文件并上传：prepare_upload（WASM）+ primary 同步 PUT + replica 异步补传。
 */
export async function uploadFile(
  filePlaintext: Uint8Array,
  credential: string,
  twelveC: TwelveCClient,
  router: RelayRouter,
  uploadClient: FetchUploadClient,
  options: UploadSessionOptions = {},
  onProgress?: (status: UploadStatusUpdate) => void,
  originalFileName?: string,
): Promise<UploadFileResult> {
  onProgress?.({ phase: 'preparing' });
  const uploads = twelveC.prepareUpload(filePlaintext, credential, originalFileName);
  const prepared = await uploadPrepared(
    uploads,
    router,
    uploadClient,
    options,
    onProgress,
  );
  return { uploads, ...prepared };
}

/**
 * 仅生成 UploadMap，不上传（供自定义上传策略使用）。
 */
export function prepareUpload(
  filePlaintext: Uint8Array,
  credential: string,
  twelveC: TwelveCClient,
  originalFileName?: string,
): UploadMap {
  return twelveC.prepareUpload(filePlaintext, credential, originalFileName);
}

export {
  resolveUploadEndpoints,
  reserveAndRegisterUploadBlocks,
  type UploadRoutePlan,
  type ReplicaUploadTarget,
  type UploadReservationMeta,
  type ReplicaReplicationJob,
} from './upload-registry.js';

export { runAsyncReplicaReplication } from './replica-replication.js';
