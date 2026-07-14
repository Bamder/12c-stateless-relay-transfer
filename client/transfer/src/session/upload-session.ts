import type { UploadMap, RelayEndpoint } from '../types.js';
import type { RegistryClient, UploadReservationMeta } from '../router/registry-client.js';
import type { RelayRouter } from '../router/relay-router.js';
import type { FetchUploadClient } from '../transport/fetch-upload-client.js';
import type { TwelveCClient, UploadPrepareSession, UploadWireBlock } from '../wasm/twelve-c-client.js';
import { BlockHashPool, DEFAULT_BLOCK_HASH_CONCURRENCY } from '../protocol/block-hash-pool.js';
import type { BlockHashEntry } from '../protocol/block-hash.js';
import {
  canUseUploadPrepareWorker,
  createDefaultUploadPrepareWorker,
  UploadPrepareWorkerClient,
  type UploadPrepareWorkerInitOptions,
} from '../wasm/upload-prepare-worker-client.js';
import {
  DEFAULT_UPLOAD_WASM_BINARY_URL,
  DEFAULT_UPLOAD_WASM_SCRIPT_URL,
} from '../wasm/upload-prepare-worker-protocol.js';
import {
  collectReplicaJobs,
  resolveUploadEndpoints,
} from './upload-registry.js';
import {
  putWithRetry,
  PutRetryExhaustedError,
  DEFAULT_PUT_TRANSIENT_MAX_ATTEMPTS,
} from '../resilience/put-with-retry.js';
import {
  resolveStripeRampConcurrency,
  waitForStripePutSlot,
  type RelayHopProtocol,
} from '../resilience/stripe-put-concurrency.js';
import type { RelayEndpointMap } from '../router/relay-router.js';
import { InFlightByteWindowMeter } from '../transport/byte-transfer-progress.js';
import { runAsyncReplicaReplication } from './replica-replication.js';
import type { UploadStatusUpdate } from './upload-status.js';
import {
  countGcmSegmentsForFileSize,
  decodeSegmentPlaintextBytesV21,
  isV2WholeFileSegmentCode,
  selectSegmentCodeForFileSize,
  validateSegmentCode,
  V21_WHOLE_FILE_THRESHOLD_BYTES,
} from '../segment-policy.js';
import {
  DEFAULT_RELAY_MAX_BODY_BYTES,
  resolveEffectiveWireBlockBytes,
  resolveUploadUses32MiBWireBlocks,
  WIRE_BLOCK_BYTES_16_MIB,
} from '../wire-block-policy.js';

const WIRE_LAYOUT_FAILURE_PATTERN = /wire layout failed/i;

function isWireLayoutFailure(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return WIRE_LAYOUT_FAILURE_PATTERN.test(error.message);
}

function isBrowserRuntime(): boolean {
  return typeof globalThis !== 'undefined' && 'window' in globalThis;
}

function resolvePrimaryPutConcurrency(
  total: number,
  explicit: number | undefined,
  hopProtocol: RelayHopProtocol,
): number {
  if (explicit !== undefined) {
    return explicit;
  }
  if (isBrowserRuntime()) {
    const cap =
      hopProtocol === 'h2'
        ? DEFAULT_BROWSER_H2_PRIMARY_PUT_CONCURRENCY
        : DEFAULT_BROWSER_PRIMARY_PUT_CONCURRENCY;
    return Math.min(total, cap);
  }
  return total;
}

function firstPrimaryEndpointUrl(
  primary: RelayEndpointMap,
): string | undefined {
  const first = primary.values().next().value;
  return first?.url;
}

function resolvePrepareMaxWireBlockBytes(
  fileSizeBytes: number,
  options: {
    maxWireBlockBytes?: number;
    relayMaxBodyBytes?: number;
    preferConservativeWireBlocks?: boolean;
  } = {},
): number {
  if (options.maxWireBlockBytes !== undefined) {
    if (
      !Number.isFinite(options.maxWireBlockBytes) ||
      options.maxWireBlockBytes <= 0
    ) {
      throw new Error('maxWireBlockBytes must be a positive finite number');
    }
    return Math.trunc(options.maxWireBlockBytes);
  }

  return resolveEffectiveWireBlockBytes({
    fileSizeBytes,
    relayMaxBodyBytes: options.relayMaxBodyBytes ?? DEFAULT_RELAY_MAX_BODY_BYTES,
    preferConservative: options.preferConservativeWireBlocks,
  });
}

export const DEFAULT_PUT_MAX_ATTEMPTS = 3;
export const DEFAULT_PUT_RETRY_DELAY_MS = 2000;
/** HTTP/1.1 浏览器对同一 host 的有效并行约 6。 */
export const DEFAULT_BROWSER_PRIMARY_PUT_CONCURRENCY = 6;
/**
 * HTTP/2 多路复用无连接数瓶颈；上限主要受在途块内存约束（约 32 MiB × 并发）。
 */
export const DEFAULT_BROWSER_H2_PRIMARY_PUT_CONCURRENCY = 12;
export const DEFAULT_REPLICA_PUT_MAX_ATTEMPTS = 5;
export const DEFAULT_REPLICA_PUT_RETRY_DELAY_MS = 1000;
export const DEFAULT_REPLICA_ASYNC_CONCURRENCY = 4;

/**
 * 上传复制策略。当前仅支持条带 primary 全部完成后再启动 replica 补传。
 * - `stripe-before-replica`：条带（Registry placement 的 primary）同步传完，副本异步补传
 */
export const UPLOAD_REPLICATION_POLICY_STRIPE_BEFORE_REPLICA =
  'stripe-before-replica' as const;

export type UploadReplicationPolicy =
  typeof UPLOAD_REPLICATION_POLICY_STRIPE_BEFORE_REPLICA;

export const DEFAULT_UPLOAD_REPLICATION_POLICY: UploadReplicationPolicy =
  UPLOAD_REPLICATION_POLICY_STRIPE_BEFORE_REPLICA;

export interface UploadSessionOptions {
  /** 并发条带 primary PUT 上限；默认不限制 */
  concurrency?: number;
  /**
   * 生产上传必传：走 reserve-tokens（token + blockHash）。
   * 省略时仅适用于 StaticRelayRouter 等离线联调。
   */
  registry?: RegistryClient;
  /** primary 单块 PUT 失败后最大尝试次数（含首次），默认 3；仅用于非瞬时 HTTP 错误 */
  putMaxAttempts?: number;
  /** 网络瞬时失败（Failed to fetch 等）最大尝试次数，默认 8 */
  putTransientMaxAttempts?: number;
  /** primary 重试退避基数（毫秒），默认 2000 */
  putRetryDelayMs?: number;
  /** replica 异步补传单块最大尝试次数（含首次），默认 5 */
  replicaPutMaxAttempts?: number;
  /** replica 补传退避基数（毫秒），默认 1000 */
  replicaPutRetryDelayMs?: number;
  /** replica 异步补传并发上限，默认 4 */
  replicaAsyncConcurrency?: number;
  /** 上传文件有效期（秒），传给 Registry reserve-tokens */
  ttlSeconds?: number;
  /**
   * SMB segment_code（0 = V2 整包，1..5 = V2.1）。
   * 省略时由应用层 {@link selectSegmentCodeForFileSize} 按文件大小选择。
   */
  segmentCode?: number;
  /** reserve 前并行块哈希并发上限，默认 12 */
  hashConcurrency?: number;
  /** 流水线阶段已算好的块哈希；提供时跳过 reserve 前哈希 */
  precomputedBlockHashes?: BlockHashEntry[];
  /**
   * 条带与副本的上传顺序。默认 {@link UPLOAD_REPLICATION_POLICY_STRIPE_BEFORE_REPLICA}：
   * 先同步完成全部条带 primary，再异步补传 replica（不与 primary 争带宽）。
   */
  replicationPolicy?: UploadReplicationPolicy;
  /** Relay 单块上限（relay.config.json）；省略时用 32 MiB。 */
  relayMaxBodyBytes?: number;
  /** 覆盖策略后的 wire 块上限；省略时按文件大小与 relayMaxBodyBytes 计算。 */
  maxWireBlockBytes?: number;
  /** 强制 16 MiB 档（设置页 / 弱网）。 */
  preferConservativeWireBlocks?: boolean;
  /**
   * 条带 primary 是否分阶段升并发（0→1、1→2、2→4、≥3→6）。
   * 省略时：单 Relay + 浏览器 + HTTP/1.1 + **32 MiB 块** 时启用。
   */
  stripeRampConcurrency?: boolean;
  /** 布局档 wire 块上限（字节）；省略时从 UploadMap 块体积推断。 */
  wireBlockBytes?: number;
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
    const detail = formatPutFailureDetail(cause);
    super(
      detail !== undefined
        ? `PUT failed for token ${token} after ${attempts} attempt(s): ${detail}`
        : `PUT failed for token ${token} after ${attempts} attempt(s)`,
    );
    this.name = 'UploadPutError';
  }
}

function formatPutFailureDetail(cause: unknown): string | undefined {
  if (cause instanceof Error && cause.message.trim().length > 0) {
    return cause.message;
  }
  if (typeof cause === 'string' && cause.trim().length > 0) {
    return cause;
  }
  return undefined;
}

/**
 * 生成 UploadMap 并上传：按 replicationPolicy 先条带 primary，再副本 replica。
 * reserve 409 由 registry 抛出；primary PUT 失败同凭证块级重试。
 */
export async function uploadPrepared(
  uploads: UploadMap,
  router: RelayRouter,
  uploadClient: FetchUploadClient,
  options: UploadSessionOptions = {},
  onProgress?: (status: UploadStatusUpdate) => void,
): Promise<UploadPreparedResult> {
  const replicationPolicy =
    options.replicationPolicy ?? DEFAULT_UPLOAD_REPLICATION_POLICY;
  if (replicationPolicy !== UPLOAD_REPLICATION_POLICY_STRIPE_BEFORE_REPLICA) {
    throw new Error(`unsupported upload replication policy: ${replicationPolicy}`);
  }

  const entries = [...uploads.entries()];
  const total = entries.length;
  const putMaxAttempts = options.putMaxAttempts ?? DEFAULT_PUT_MAX_ATTEMPTS;
  const putTransientMaxAttempts =
    options.putTransientMaxAttempts ?? DEFAULT_PUT_TRANSIENT_MAX_ATTEMPTS;
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
    precomputedBlockHashes: options.precomputedBlockHashes,
    hashConcurrency: options.hashConcurrency,
  });

  const sampleUrl = firstPrimaryEndpointUrl(routePlan.primary);
  const hopProtocol: RelayHopProtocol =
    sampleUrl !== undefined
      ? await uploadClient.probeHopProtocol(sampleUrl)
      : 'unknown';
  const concurrency = resolvePrimaryPutConcurrency(
    total,
    options.concurrency,
    hopProtocol,
  );
  const rampConcurrency = resolveStripeRampConcurrency({
    explicit: options.stripeRampConcurrency,
    relayCount: routePlan.reservation?.placementPlan?.relayCount,
    hopProtocol,
    uses32MiBWireBlocks: resolveUploadUses32MiBWireBlocks(
      uploads,
      options.wireBlockBytes,
    ),
    isBrowser: isBrowserRuntime(),
  });

  await uploadStripePrimaryBlocks(
    entries,
    routePlan.primary,
    uploadClient,
    {
      maxConcurrency: concurrency,
      rampConcurrency,
      putMaxAttempts,
      putTransientMaxAttempts,
      putRetryDelayMs,
    },
    onProgress,
  );

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

async function uploadStripePrimaryBlocks(
  entries: Array<[string, Uint8Array]>,
  primaryEndpoints: Map<string, RelayEndpoint>,
  uploadClient: FetchUploadClient,
  options: {
    maxConcurrency: number;
    rampConcurrency: boolean;
    putMaxAttempts: number;
    putTransientMaxAttempts: number;
    putRetryDelayMs: number;
  },
  onProgress?: (status: UploadStatusUpdate) => void,
): Promise<void> {
  const total = entries.length;
  let completed = 0;
  let inFlight = 0;
  let nextIndex = 0;
  let completedBytes = 0;
  const transferBytesTotal = entries.reduce(
    (sum, [, blob]) => sum + blob.byteLength,
    0,
  );
  const windowMeter = new InFlightByteWindowMeter();
  let transferBytesHighWater = 0;

  const reportUploading = (): void => {
    const window = windowMeter.snapshot();
    const transferBytesTransferred = Math.max(
      transferBytesHighWater,
      completedBytes + window.windowBytesTransferred,
    );
    transferBytesHighWater = transferBytesTransferred;
    onProgress?.({
      phase: 'uploading',
      completed,
      inFlight,
      total,
      transferBytesTransferred,
      transferBytesTotal,
    });
  };

  async function worker(): Promise<void> {
    while (true) {
      await waitForStripePutSlot(
        () => inFlight,
        () => completed,
        options.maxConcurrency,
        options.rampConcurrency,
      );
      if (nextIndex >= total) {
        return;
      }

      const current = nextIndex++;
      const [token, blob] = entries[current]!;
      const endpoint = primaryEndpoints.get(token);
      if (endpoint === undefined) {
        throw new Error(`no stripe primary relay endpoint for token: ${token}`);
      }
      const laneId = `${token}:${current}`;
      inFlight++;
      windowMeter.begin(laneId, blob.byteLength);
      reportUploading();
      try {
        await putWithRetry(
          uploadClient,
          endpoint,
          blob,
          {
            maxAttempts: options.putMaxAttempts,
            transientMaxAttempts: options.putTransientMaxAttempts,
            baseDelayMs: options.putRetryDelayMs,
          },
          {
            onUploadProgress: (progress) => {
              windowMeter.setTransferred(laneId, progress.bytesTransferred);
              reportUploading();
            },
          },
        );
        // Move bytes from the in-flight lane into completed before ending the lane
        // so concurrent progress reports never dip by one full block.
        completedBytes += blob.byteLength;
        windowMeter.end(laneId);
        completed++;
      } catch (cause) {
        windowMeter.end(laneId);
        const attempts =
          cause instanceof PutRetryExhaustedError
            ? cause.attempts
            : options.putTransientMaxAttempts;
        const rootCause =
          cause instanceof PutRetryExhaustedError ? cause.cause : cause;
        throw new UploadPutError(token, attempts, rootCause);
      } finally {
        inFlight--;
      }
      reportUploading();
    }
  }

  const workers = Array.from(
    { length: Math.min(options.maxConcurrency, total) },
    () => worker(),
  );
  await Promise.all(workers);
}

export interface UploadFileResult {
  uploads: UploadMap;
  replicaSync?: Promise<void>;
  reservation?: UploadReservationMeta;
}

export interface PrepareUploadStreamingOptions {
  /** Emscripten JS URL；默认 `/wasm/twelve_c_cryptography.js` */
  wasmScriptUrl?: string;
  /** WASM 二进制 URL；默认 `/wasm/twelve_c_cryptography.wasm` */
  wasmBinaryUrl?: string;
  /** 创建上传加密 Worker；Web 端由 Vite `?worker` 注入 */
  createUploadWorker?: () => Worker;
  /**
   * 是否优先使用 Worker。默认 true（在 Worker 可用时）。
   * 设为 false 可强制走主线程流式路径。
   */
  preferWorker?: boolean;
  /** 每产出一块 wire 数据即回调（用于流水线哈希） */
  onWireBlockReady?: (block: UploadWireBlock) => void;
  /** Relay 单块上限（relay.config.json）；省略时用 32 MiB。 */
  relayMaxBodyBytes?: number;
  /** 覆盖策略后的 wire 块上限；省略时按文件大小与 relayMaxBodyBytes 计算。 */
  maxWireBlockBytes?: number;
  /** 强制 16 MiB 档（设置页 / 弱网）。 */
  preferConservativeWireBlocks?: boolean;
}

function storeWireBlock(
  uploads: UploadMap,
  block: UploadWireBlock,
  onWireBlockReady?: (block: UploadWireBlock) => void,
): void {
  uploads.set(block.token, block.data);
  onWireBlockReady?.(block);
}

export interface PrepareUploadStreamingResult {
  uploads: UploadMap;
  blockHashes: BlockHashEntry[];
}

/**
 * 流式加密并与块哈希流水线：加密产出块时即并行哈希，finalize 后立即可 reserve。
 */
export async function prepareUploadStreamingWithHashes(
  file: File,
  credential: string,
  twelveC: TwelveCClient,
  originalFileName?: string,
  segmentCode?: number,
  onProgress?: (status: UploadStatusUpdate) => void,
  options: PrepareUploadStreamingOptions & { hashConcurrency?: number } = {},
): Promise<PrepareUploadStreamingResult> {
  const hashPool = new BlockHashPool({
    concurrency: options.hashConcurrency ?? DEFAULT_BLOCK_HASH_CONCURRENCY,
  });

  const uploads = await prepareUploadStreaming(
    file,
    credential,
    twelveC,
    originalFileName,
    segmentCode,
    (status) => onProgress?.(status),
    {
      ...options,
      onWireBlockReady: (block) => {
        hashPool.enqueue(block.token, block.data);
        options.onWireBlockReady?.(block);
      },
    },
  );

  const blockHashes = await hashPool.drain();
  return { uploads, blockHashes };
}

/** 主线程回退路径：单次 feed 后让出，避免 UI 冻结。 */
const UPLOAD_FEED_YIELD_CHUNK_BYTES = 256 * 1024;
/** Worker 路径：无需频繁让出，可用更大块。 */
const UPLOAD_WORKER_FEED_CHUNK_BYTES = 4 * 1024 * 1024;
/** 从磁盘读取文件时的切片大小，避免一次分配整段 GCM 明文。 */
const UPLOAD_FILE_READ_SLICE_BYTES = 2 * 1024 * 1024;
/** 加密进度 UI 刷新间隔（字节）。 */
const UPLOAD_PROGRESS_REPORT_INTERVAL_BYTES = 4 * 1024 * 1024;

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      setTimeout(() => resolve(), 0);
    });
  });
}

async function feedUploadSessionWithYield(
  session: UploadPrepareSession,
  chunk: Uint8Array,
  onPartialBytesFed?: (delta: number) => void,
): Promise<void> {
  const step = UPLOAD_FEED_YIELD_CHUNK_BYTES;
  let bytesSinceLastReport = 0;
  for (let offset = 0; offset < chunk.length; offset += step) {
    const end = Math.min(offset + step, chunk.length);
    session.feed(chunk.subarray(offset, end));
    const delta = end - offset;
    bytesSinceLastReport += delta;
    if (onPartialBytesFed !== undefined && bytesSinceLastReport >= UPLOAD_PROGRESS_REPORT_INTERVAL_BYTES) {
      onPartialBytesFed(bytesSinceLastReport);
      bytesSinceLastReport = 0;
    }
    await yieldToBrowser();
  }
  if (onPartialBytesFed !== undefined && bytesSinceLastReport > 0) {
    onPartialBytesFed(bytesSinceLastReport);
  }
}

/**
 * 按 GCM 明文段大小切片读取文件（与 segment_code 一致），避免整文件 arrayBuffer。
 */
async function* readFileByGcmSegments(
  file: File,
  segmentCode: number,
): AsyncGenerator<Uint8Array> {
  if (isV2WholeFileSegmentCode(segmentCode)) {
    if (file.size > 0) {
      yield new Uint8Array(await file.arrayBuffer());
    }
    return;
  }

  const segmentBytes = decodeSegmentPlaintextBytesV21(segmentCode);
  let offset = 0;
  while (offset < file.size) {
    const segmentEnd = Math.min(offset + segmentBytes, file.size);
    let sliceOffset = offset;
    while (sliceOffset < segmentEnd) {
      const length = Math.min(
        UPLOAD_FILE_READ_SLICE_BYTES,
        segmentEnd - sliceOffset,
      );
      const slice = file.slice(sliceOffset, sliceOffset + length);
      yield new Uint8Array(await slice.arrayBuffer());
      sliceOffset += length;
    }
    offset = segmentEnd;
  }
}

/**
 * 流式生成 UploadMap：按 GCM 段大小读文件并 feed WASM。
 * 大文件优先在 Web Worker 中加密，失败时回退主线程。
 */
export async function prepareUploadStreaming(
  file: File,
  credential: string,
  twelveC: TwelveCClient,
  originalFileName?: string,
  segmentCode?: number,
  onProgress?: (status: Extract<UploadStatusUpdate, { phase: 'preparing' }>) => void,
  options: PrepareUploadStreamingOptions = {},
): Promise<UploadMap> {
  const resolvedSegmentCode =
    segmentCode ?? selectSegmentCodeForFileSize(file.size);
  validateSegmentCode(resolvedSegmentCode);

  let maxWireBlockBytes = resolvePrepareMaxWireBlockBytes(file.size, options);
  try {
    return await executePrepareUploadStreaming(
      file,
      credential,
      twelveC,
      originalFileName ?? file.name,
      resolvedSegmentCode,
      maxWireBlockBytes,
      onProgress,
      options,
    );
  } catch (error) {
    if (
      !isWireLayoutFailure(error) ||
      maxWireBlockBytes <= WIRE_BLOCK_BYTES_16_MIB
    ) {
      throw error;
    }
    console.warn(
      'Wire layout failed with larger block cap; retrying with 16 MiB',
      error,
    );
    maxWireBlockBytes = WIRE_BLOCK_BYTES_16_MIB;
    return executePrepareUploadStreaming(
      file,
      credential,
      twelveC,
      originalFileName ?? file.name,
      resolvedSegmentCode,
      maxWireBlockBytes,
      onProgress,
      options,
    );
  }
}

async function executePrepareUploadStreaming(
  file: File,
  credential: string,
  twelveC: TwelveCClient,
  originalFileName: string,
  resolvedSegmentCode: number,
  maxWireBlockBytes: number,
  onProgress: ((status: Extract<UploadStatusUpdate, { phase: 'preparing' }>) => void) | undefined,
  options: PrepareUploadStreamingOptions,
): Promise<UploadMap> {
  const preferWorker = options.preferWorker !== false;
  const workerAvailable = canUseUploadPrepareWorker(options.createUploadWorker);

  if (preferWorker && workerAvailable) {
    try {
      return await prepareUploadStreamingInWorker(
        file,
        credential,
        originalFileName,
        resolvedSegmentCode,
        maxWireBlockBytes,
        onProgress,
        options,
      );
    } catch (error) {
      if (options.preferWorker === true) {
        throw error;
      }
      console.warn(
        'Upload prepare worker failed; falling back to main-thread WASM',
        error,
      );
    }
  }

  return prepareUploadStreamingOnMainThread(
    file,
    credential,
    twelveC,
    originalFileName,
    resolvedSegmentCode,
    maxWireBlockBytes,
    onProgress,
    options,
  );
}

/** Worker 创建 + init 最多尝试次数；第二次仍失败则由上层回退主线程。 */
const UPLOAD_PREPARE_WORKER_CREATE_ATTEMPTS = 2;

async function createInitializedUploadPrepareWorker(
  createWorker: () => Worker,
  initOptions: UploadPrepareWorkerInitOptions,
): Promise<UploadPrepareWorkerClient> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= UPLOAD_PREPARE_WORKER_CREATE_ATTEMPTS; attempt++) {
    let client: UploadPrepareWorkerClient | null = null;
    try {
      client = new UploadPrepareWorkerClient(createWorker());
      await client.init(initOptions);
      return client;
    } catch (error) {
      lastError = error;
      client?.dispose();
      if (attempt < UPLOAD_PREPARE_WORKER_CREATE_ATTEMPTS) {
        console.warn(
          'Upload prepare worker create/init failed; retrying',
          error,
        );
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError ?? 'upload prepare worker create failed'));
}

async function prepareUploadStreamingInWorker(
  file: File,
  credential: string,
  originalFileName: string,
  resolvedSegmentCode: number,
  maxWireBlockBytes: number,
  onProgress: ((status: Extract<UploadStatusUpdate, { phase: 'preparing' }>) => void) | undefined,
  options: PrepareUploadStreamingOptions,
): Promise<UploadMap> {
  const segmentTotal = countGcmSegmentsForFileSize(file.size, resolvedSegmentCode);
  const segmentBytes = isV2WholeFileSegmentCode(resolvedSegmentCode)
    ? file.size
    : decodeSegmentPlaintextBytesV21(resolvedSegmentCode);

  onProgress?.({
    phase: 'preparing',
    bytesFed: 0,
    totalBytes: file.size,
    segmentIndex: file.size === 0 ? 0 : 1,
    segmentTotal,
  });

  const createWorker =
    options.createUploadWorker ?? createDefaultUploadPrepareWorker;
  const client = await createInitializedUploadPrepareWorker(createWorker, {
    wasmScriptUrl: options.wasmScriptUrl ?? DEFAULT_UPLOAD_WASM_SCRIPT_URL,
    wasmBinaryUrl: options.wasmBinaryUrl ?? DEFAULT_UPLOAD_WASM_BINARY_URL,
    credential,
    fileName: originalFileName,
    fileSize: file.size,
    segmentCode: resolvedSegmentCode,
    maxWireBlockBytes,
  });

  const uploads: UploadMap = new Map();
  let bytesFed = 0;

  const reportPreparingProgress = (): void => {
    const segmentIndex = isV2WholeFileSegmentCode(resolvedSegmentCode)
      ? 1
      : Math.min(segmentTotal, Math.max(1, Math.ceil(bytesFed / segmentBytes)));
    onProgress?.({
      phase: 'preparing',
      bytesFed,
      totalBytes: file.size,
      segmentIndex,
      segmentTotal,
    });
  };

  try {
    for await (const chunk of readFileByGcmSegments(file, resolvedSegmentCode)) {
      for (
        let offset = 0;
        offset < chunk.length;
        offset += UPLOAD_WORKER_FEED_CHUNK_BYTES
      ) {
        const end = Math.min(offset + UPLOAD_WORKER_FEED_CHUNK_BYTES, chunk.length);
        const part = chunk.subarray(offset, end);
        const result = await client.feed(part);
        bytesFed = result.bytesFed;
        for (const block of result.blocks) {
          storeWireBlock(uploads, block, options.onWireBlockReady);
        }
        reportPreparingProgress();
      }
    }

    const token0 = await client.finalize();
    storeWireBlock(uploads, token0, options.onWireBlockReady);
  } finally {
    client.dispose();
  }

  onProgress?.({
    phase: 'preparing',
    bytesFed: file.size,
    totalBytes: file.size,
    segmentIndex: segmentTotal,
    segmentTotal,
  });

  return uploads;
}

async function prepareUploadStreamingOnMainThread(
  file: File,
  credential: string,
  twelveC: TwelveCClient,
  originalFileName: string,
  resolvedSegmentCode: number,
  maxWireBlockBytes: number,
  onProgress: ((status: Extract<UploadStatusUpdate, { phase: 'preparing' }>) => void) | undefined,
  options: PrepareUploadStreamingOptions = {},
): Promise<UploadMap> {
  const segmentTotal = countGcmSegmentsForFileSize(
    file.size,
    resolvedSegmentCode,
  );
  const segmentBytes = isV2WholeFileSegmentCode(resolvedSegmentCode)
    ? file.size
    : decodeSegmentPlaintextBytesV21(resolvedSegmentCode);

  onProgress?.({
    phase: 'preparing',
    bytesFed: 0,
    totalBytes: file.size,
    segmentIndex: file.size === 0 ? 0 : 1,
    segmentTotal,
  });

  await yieldToBrowser();
  const session = twelveC.createUploadPrepareSession(
    credential,
    originalFileName,
    file.size,
    resolvedSegmentCode,
    maxWireBlockBytes,
  );
  await yieldToBrowser();

  const uploads: UploadMap = new Map();
  let bytesFed = 0;

  const reportPreparingProgress = (): void => {
    const segmentIndex = isV2WholeFileSegmentCode(resolvedSegmentCode)
      ? 1
      : Math.min(
          segmentTotal,
          Math.max(1, Math.ceil(bytesFed / segmentBytes)),
        );
    onProgress?.({
      phase: 'preparing',
      bytesFed,
      totalBytes: file.size,
      segmentIndex,
      segmentTotal,
    });
  };

  for await (const chunk of readFileByGcmSegments(file, resolvedSegmentCode)) {
    await feedUploadSessionWithYield(session, chunk, (delta) => {
      bytesFed += delta;
      reportPreparingProgress();
    });
    for (const block of session.takeReadyBlocks()) {
      storeWireBlock(uploads, block, options.onWireBlockReady);
    }
    await yieldToBrowser();
  }

  await yieldToBrowser();
  const token0 = session.finalize();
  storeWireBlock(uploads, token0, options.onWireBlockReady);

  await yieldToBrowser();

  onProgress?.({
    phase: 'preparing',
    bytesFed: file.size,
    totalBytes: file.size,
    segmentIndex: segmentTotal,
    segmentTotal,
  });

  return uploads;
}

/**
 * 加密文件并上传：prepare_upload（WASM）+ primary 同步 PUT + replica 异步补传。
 */
export async function uploadFile(
  filePlaintext: Uint8Array | File,
  credential: string,
  twelveC: TwelveCClient,
  router: RelayRouter,
  uploadClient: FetchUploadClient,
  options: UploadSessionOptions = {},
  onProgress?: (status: UploadStatusUpdate) => void,
  originalFileName?: string,
): Promise<UploadFileResult> {
  let resolvedUploads: UploadMap;
  if (
    filePlaintext instanceof File &&
    filePlaintext.size > V21_WHOLE_FILE_THRESHOLD_BYTES
  ) {
    const prepared = await prepareUploadStreamingWithHashes(
      filePlaintext,
      credential,
      twelveC,
      originalFileName ?? filePlaintext.name,
      options.segmentCode,
      onProgress,
      {
        hashConcurrency: options.hashConcurrency,
        relayMaxBodyBytes: options.relayMaxBodyBytes,
        maxWireBlockBytes: options.maxWireBlockBytes,
        preferConservativeWireBlocks: options.preferConservativeWireBlocks,
      },
    );
    resolvedUploads = prepared.uploads;
    const preparedUpload = await uploadPrepared(
      resolvedUploads,
      router,
      uploadClient,
      {
        ...options,
        precomputedBlockHashes: prepared.blockHashes,
      },
      onProgress,
    );
    return { uploads: resolvedUploads, ...preparedUpload };
  } else {
    onProgress?.({ phase: 'preparing' });
    const bytes =
      filePlaintext instanceof File
        ? new Uint8Array(await filePlaintext.arrayBuffer())
        : filePlaintext;
    const segmentCode =
      options.segmentCode ?? selectSegmentCodeForFileSize(bytes.length);
    validateSegmentCode(segmentCode);
    const maxWireBlockBytes = resolvePrepareMaxWireBlockBytes(bytes.length, {
      maxWireBlockBytes: options.maxWireBlockBytes,
      relayMaxBodyBytes: options.relayMaxBodyBytes,
      preferConservativeWireBlocks: options.preferConservativeWireBlocks,
    });
    resolvedUploads = twelveC.prepareUpload(
      bytes,
      credential,
      originalFileName ??
        (filePlaintext instanceof File ? filePlaintext.name : undefined),
      segmentCode,
      maxWireBlockBytes,
    );
  }

  const prepared = await uploadPrepared(
    resolvedUploads,
    router,
    uploadClient,
    options,
    onProgress,
  );
  return { uploads: resolvedUploads, ...prepared };
}

/**
 * 仅生成 UploadMap，不上传（供自定义上传策略使用）。
 */
export function prepareUpload(
  filePlaintext: Uint8Array,
  credential: string,
  twelveC: TwelveCClient,
  originalFileName?: string,
  segmentCode?: number,
  prepareOptions: {
    maxWireBlockBytes?: number;
    relayMaxBodyBytes?: number;
    preferConservativeWireBlocks?: boolean;
  } = {},
): UploadMap {
  const resolvedSegmentCode =
    segmentCode ?? selectSegmentCodeForFileSize(filePlaintext.length);
  validateSegmentCode(resolvedSegmentCode);
  let maxWireBlockBytes = resolvePrepareMaxWireBlockBytes(
    filePlaintext.length,
    prepareOptions,
  );
  try {
    return twelveC.prepareUpload(
      filePlaintext,
      credential,
      originalFileName,
      resolvedSegmentCode,
      maxWireBlockBytes,
    );
  } catch (error) {
    if (
      isWireLayoutFailure(error) &&
      maxWireBlockBytes > WIRE_BLOCK_BYTES_16_MIB
    ) {
      return twelveC.prepareUpload(
        filePlaintext,
        credential,
        originalFileName,
        resolvedSegmentCode,
        WIRE_BLOCK_BYTES_16_MIB,
      );
    }
    throw error;
  }
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
