import { byteLengthsEqual, splitCredential, toSafeByteLength, type UploadMap } from '../types.js';
import type { TwelveCClient, ReceiveDecryptSession } from '../wasm/twelve-c-client.js';
import type { ReceiveTransport } from '../transport/receive-transport.js';
import {
  FetchReceiveTransport,
  type ReceiveTransportActivity,
} from '../transport/fetch-receive-transport.js';
import {
  computeReceiveDownloadPlan,
  deriveIndexTokens,
} from '../protocol/receive-plan.js';
import { resolveReceivePrefetchCount } from '../protocol/receive-prefetch-policy.js';
import { resolveReceivedFileName } from '../protocol/received-file-name.js';
import { V21_WHOLE_FILE_THRESHOLD_BYTES } from '../segment-policy.js';
import {
  createReceivePlaintextAccumulator,
  finalizeReceiveDecryptToBlob,
} from './finalize-receive-decrypt.js';
import { DEFAULT_RELAY_MAX_BODY_BYTES } from '../wire-block-policy.js';
import type { DownloadStatusUpdate } from './download-status.js';

export type { DownloadStatusUpdate } from './download-status.js';

export {
  DEFAULT_BROWSER_RECEIVE_MEMORY_BUDGET_BYTES,
  MOBILE_BROWSER_RECEIVE_MEMORY_BUDGET_BYTES,
  MIN_BROWSER_RECEIVE_MEMORY_BUDGET_BYTES,
  MAX_BROWSER_RECEIVE_MEMORY_BUDGET_BYTES,
  MAX_MOBILE_BROWSER_RECEIVE_MEMORY_BUDGET_BYTES,
  MIN_BROWSER_RECEIVE_PREFETCH,
  MAX_BROWSER_RECEIVE_PREFETCH,
  probeBrowserReceiveMemoryBudgetBytes,
  resolveBrowserReceivePrefetchCount,
  resolveReceivePrefetchCount,
} from '../protocol/receive-prefetch-policy.js';

export interface DownloadSessionOptions {
  /**
   * Π_Recv_Adaptive 初始并发 m（含 Token[0]）。
   * 省略时浏览器按内存预算推导；原生默认 64。
   */
  initialTokens?: number;
  /** 解析 SMB 前估计 wire 块上限（registry relay.config）；默认 32 MiB */
  relayMaxBodyBytes?: number;
  onStatus?: (status: DownloadStatusUpdate) => void;
}

export interface DownloadAdaptiveResult {
  data: Blob;
  fileName: string;
}

function cloneWireBlock(data: Uint8Array): Uint8Array {
  return new Uint8Array(data);
}

function assertWireBlockSize(
  token: string,
  data: Uint8Array,
  expectedSize: number,
): Uint8Array {
  if (data.length !== expectedSize) {
    throw new Error(
      `download block size mismatch for token ${token}: ` +
        `got ${data.length} bytes, expected ${expectedSize}`,
    );
  }
  return data;
}

function transportInFlight(transport: ReceiveTransport): number {
  return transport.inFlightCount?.() ?? 0;
}

function transportInFlightBytes(transport: ReceiveTransport): number {
  if (!(transport instanceof FetchReceiveTransport)) {
    return 0;
  }
  return transport.getByteWindowSnapshot().windowBytesTransferred;
}

function downloadingStatus(
  transport: ReceiveTransport,
  completed: number,
  total: number,
  wireBlockSize: number,
): DownloadStatusUpdate {
  const transferBytesTotal =
    wireBlockSize > 0 && total > 0 ? wireBlockSize * total : undefined;
  const transferBytesTransferred =
    transferBytesTotal !== undefined
      ? Math.min(
          transferBytesTotal,
          completed * wireBlockSize + transportInFlightBytes(transport),
        )
      : undefined;
  return {
    phase: 'downloading',
    completed,
    total,
    inFlight: transportInFlight(transport),
    ...(transferBytesTransferred !== undefined
      ? { transferBytesTransferred }
      : {}),
    ...(transferBytesTotal !== undefined ? { transferBytesTotal } : {}),
  };
}

function prefetchIndexRange(
  transport: ReceiveTransport,
  twelveC: TwelveCClient,
  searchCode: string,
  fromInclusive: number,
  toExclusive: number,
): Promise<void> {
  if (fromInclusive >= toExclusive) {
    return Promise.resolve();
  }
  return Promise.resolve(
    transport.startConcurrentGet(
      deriveIndexTokens(twelveC, searchCode, fromInclusive, toExclusive),
    ),
  );
}

function cancelIndexRange(
  transport: ReceiveTransport,
  twelveC: TwelveCClient,
  searchCode: string,
  fromInclusive: number,
  toExclusive: number,
): void {
  if (fromInclusive >= toExclusive) {
    return;
  }
  transport.cancelPending(
    deriveIndexTokens(twelveC, searchCode, fromInclusive, toExclusive),
  );
}

async function yieldToBrowser(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      setTimeout(() => resolve(), 0);
    });
  });
}

async function decryptDownloadedLargeFile(
  credential: string,
  twelveC: TwelveCClient,
  searchCode: string,
  token0Wire: Uint8Array,
  wireBlockSize: number,
  totalTokens: number,
  originalFileLength: number,
  transport: ReceiveTransport,
  concurrentM: number,
  onStatus?: (status: DownloadStatusUpdate) => void,
): Promise<Blob> {
  let session: ReceiveDecryptSession;
  try {
    session = twelveC.createReceiveDecryptSession(credential, token0Wire);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('ReceiveDecryptSession')) {
      throw error;
    }
    throw new Error(
      `${message} 请运行 client/build.ps1 -ForceWasm 并硬刷新页面后重试。`,
      { cause: error },
    );
  }

  const expectedLength = toSafeByteLength(
    session.originalFileLength?.() ?? originalFileLength,
    'originalFileLength',
  );

  const plaintext = createReceivePlaintextAccumulator(expectedLength);

  for (let tokenIndex = 1; tokenIndex < totalTokens; tokenIndex++) {
    const windowEnd = Math.min(totalTokens, tokenIndex + concurrentM);
    onStatus?.({
      phase: 'resolving_window',
      fromIndex: tokenIndex + 1,
      toIndex: windowEnd,
      total: totalTokens,
    });
    await yieldToBrowser();
    await prefetchIndexRange(
      transport,
      twelveC,
      searchCode,
      tokenIndex + 1,
      windowEnd,
    );

    onStatus?.(
      downloadingStatus(transport, tokenIndex, totalTokens, wireBlockSize),
    );
    const token = twelveC.deriveUploadToken(searchCode, tokenIndex);
    const wire = assertWireBlockSize(
      token,
      cloneWireBlock(await transport.get(token)),
      wireBlockSize,
    );
    session.addWireToken(tokenIndex, wire);
    await plaintext.drainSession(session);
    onStatus?.(
      downloadingStatus(transport, tokenIndex + 1, totalTokens, wireBlockSize),
    );
    if (tokenIndex % 4 === 0) {
      await yieldToBrowser();
    }
  }

  onStatus?.({ phase: 'decrypting', total: totalTokens });
  return await finalizeReceiveDecryptToBlob(session, plaintext);
}

type DownloadActivityContext = {
  smbParsed: boolean;
  totalTokens: number;
  completed: number;
  wireBlockSize: number;
};

function downloadTransferBytes(
  context: DownloadActivityContext,
  inFlightBytes: number,
): {
  transferBytesTransferred?: number;
  transferBytesTotal?: number;
} {
  if (
    !context.smbParsed ||
    context.totalTokens <= 0 ||
    context.wireBlockSize <= 0
  ) {
    return {};
  }
  const transferBytesTotal = context.wireBlockSize * context.totalTokens;
  return {
    transferBytesTotal,
    transferBytesTransferred: Math.min(
      transferBytesTotal,
      context.completed * context.wireBlockSize + inFlightBytes,
    ),
  };
}

function mapTransportActivityToStatus(
  activity: ReceiveTransportActivity,
  token0: string,
  context: DownloadActivityContext,
  inFlight: number,
  inFlightBytes: number,
): DownloadStatusUpdate | null {
  switch (activity.kind) {
    case 'resolving':
      // After download has started, sliding-window resolve stays background-only.
      if (!context.smbParsed || context.completed > 0) {
        return null;
      }
      return {
        phase: 'resolving_window',
        fromIndex: 0,
        toIndex: activity.tokenCount,
        total: context.totalTokens,
      };
    case 'download_started':
      if (!context.smbParsed) {
        if (activity.token !== token0) {
          return null;
        }
        return {
          phase: 'awaiting_metadata_block',
          prefetchCount: Math.max(1, inFlight),
        };
      }
      if (context.totalTokens <= 0) {
        return null;
      }
      return {
        phase: 'downloading',
        completed: context.completed,
        total: context.totalTokens,
        inFlight,
        ...downloadTransferBytes(context, inFlightBytes),
      };
    case 'download_byte_progress':
      if (!context.smbParsed || context.totalTokens <= 0) {
        return null;
      }
      return {
        phase: 'downloading',
        completed: context.completed,
        total: context.totalTokens,
        inFlight,
        ...downloadTransferBytes(context, activity.windowBytesTransferred),
      };
    case 'waiting':
      if (activity.token !== token0) {
        return null;
      }
      return {
        phase: 'waiting_metadata_block',
        reason: activity.reason,
        attempt: activity.attempt,
      };
    default:
      return null;
  }
}

function attachDownloadActivityListener(
  transport: ReceiveTransport,
  token0: string,
  context: DownloadActivityContext,
  onStatus?: (status: DownloadStatusUpdate) => void,
): () => void {
  if (!(transport instanceof FetchReceiveTransport) || onStatus === undefined) {
    return () => undefined;
  }

  transport.setActivityListener((activity) => {
    const inFlightBytes =
      transport.getByteWindowSnapshot().windowBytesTransferred;
    const status = mapTransportActivityToStatus(
      activity,
      token0,
      context,
      transport.inFlightCount(),
      inFlightBytes,
    );
    if (status !== null) {
      onStatus(status);
    }
  });

  return () => {
    transport.setActivityListener(null);
  };
}

/**
 * Π_Recv_Adaptive：Token[0] 混在首批 m 块并发预取 → 解析 SMB → 扩缩/中止 → 解密。
 */
export async function downloadAdaptive(
  credential: string,
  transport: ReceiveTransport,
  twelveC: TwelveCClient,
  options: DownloadSessionOptions = {},
): Promise<DownloadAdaptiveResult> {
  const onStatus = options.onStatus;
  const relayMaxBodyBytes =
    options.relayMaxBodyBytes ?? DEFAULT_RELAY_MAX_BODY_BYTES;

  const estimatedM = resolveReceivePrefetchCount(0, {
    explicit: options.initialTokens,
    relayMaxBodyBytes,
  });
  if (estimatedM <= 0) {
    throw new Error('initial token count must be greater than zero');
  }

  const { searchCode } = splitCredential(credential);
  const token0 = twelveC.deriveUploadToken(searchCode, 0);

  const activityContext: DownloadActivityContext = {
    smbParsed: false,
    totalTokens: 0,
    completed: 0,
    wireBlockSize: 0,
  };
  let transferBytesHighWater = 0;

  const reportStatus = (status: DownloadStatusUpdate): void => {
    if (status.phase === 'downloading') {
      activityContext.completed = status.completed;
      if (
        status.transferBytesTransferred !== undefined &&
        status.transferBytesTotal !== undefined
      ) {
        transferBytesHighWater = Math.max(
          transferBytesHighWater,
          status.transferBytesTransferred,
        );
        onStatus?.({
          ...status,
          transferBytesTransferred: Math.min(
            status.transferBytesTotal,
            transferBytesHighWater,
          ),
        });
        return;
      }
    }
    onStatus?.(status);
  };

  const detachActivityListener = attachDownloadActivityListener(
    transport,
    token0,
    activityContext,
    onStatus === undefined ? undefined : reportStatus,
  );

  try {
    reportStatus({
      phase: 'resolving_initial',
      fromIndex: 0,
      toIndex: estimatedM,
      total: estimatedM,
    });
    await yieldToBrowser();
    await prefetchIndexRange(transport, twelveC, searchCode, 0, estimatedM);
    reportStatus({
      phase: 'awaiting_metadata_block',
      prefetchCount: Math.max(estimatedM, transportInFlight(transport)),
    });

    const token0Wire = cloneWireBlock(await transport.get(token0));

    reportStatus({ phase: 'parsing_metadata' });
    const metadata = twelveC.parseSmbEncrypted(credential, token0Wire);
    const wireBlockSize = metadata.wireBlockSize;
    if (transport instanceof FetchReceiveTransport) {
      transport.setExpectedWireBlockBytes(wireBlockSize);
    }

    if (token0Wire.length !== wireBlockSize) {
      throw new Error(
        `token0 wire size mismatch: got ${token0Wire.length}, expected ${wireBlockSize}`,
      );
    }

    const fileName = resolveReceivedFileName(metadata.originalFileName, credential);
    const totalTokens = metadata.numTokens;
    activityContext.smbParsed = true;
    activityContext.totalTokens = totalTokens;
    activityContext.completed = 1;
    activityContext.wireBlockSize = wireBlockSize;
    const concurrentM = resolveReceivePrefetchCount(wireBlockSize, {
      explicit: options.initialTokens,
      relayMaxBodyBytes,
    });

    const plan = computeReceiveDownloadPlan(
      twelveC,
      searchCode,
      concurrentM,
      totalTokens,
    );

    if (estimatedM > concurrentM) {
      cancelIndexRange(
        transport,
        twelveC,
        searchCode,
        concurrentM,
        estimatedM,
      );
    }
    if (plan.cancelAfterSmb.length > 0) {
      transport.cancelPending(plan.cancelAfterSmb);
    }

    const useStreamingDecrypt =
      metadata.originalFileLength > V21_WHOLE_FILE_THRESHOLD_BYTES;

    reportStatus(downloadingStatus(transport, 1, totalTokens, wireBlockSize));

    if (useStreamingDecrypt) {
      const data = await decryptDownloadedLargeFile(
        credential,
        twelveC,
        searchCode,
        token0Wire,
        wireBlockSize,
        totalTokens,
        metadata.originalFileLength,
        transport,
        concurrentM,
        reportStatus,
      );
      if (!byteLengthsEqual(data.size, metadata.originalFileLength)) {
        throw new Error(
          `decrypted file size mismatch: got ${data.size}, ` +
            `expected ${metadata.originalFileLength}`,
        );
      }
      return { data, fileName };
    }

    if (plan.fetchAfterSmb.length > 0) {
      const fromIndex = Math.min(concurrentM, totalTokens);
      reportStatus({
        phase: 'resolving_window',
        fromIndex,
        toIndex: totalTokens,
        total: totalTokens,
      });
      await yieldToBrowser();
      await Promise.resolve(transport.startConcurrentGet(plan.fetchAfterSmb));
      reportStatus(downloadingStatus(transport, 1, totalTokens, wireBlockSize));
    }

    const uploads: UploadMap = new Map([[token0, token0Wire]]);

    for (let tokenIndex = 1; tokenIndex < totalTokens; tokenIndex++) {
      const token = twelveC.deriveUploadToken(searchCode, tokenIndex);
      uploads.set(
        token,
        assertWireBlockSize(token, await transport.get(token), wireBlockSize),
      );
      reportStatus(
        downloadingStatus(
          transport,
          tokenIndex + 1,
          totalTokens,
          wireBlockSize,
        ),
      );
    }

    reportStatus({ phase: 'decrypting', total: totalTokens });

    const plaintext = twelveC.receiveFromUploadMap(credential, uploads);
    return {
      data: new Blob([plaintext.slice()], {
        type: 'application/octet-stream',
      }),
      fileName,
    };
  } finally {
    detachActivityListener();
  }
}

/**
 * 已从各 relay 凑齐 UploadMap 时，仅做密码学解密（无下载调度）。
 */
export function receiveFromUploadMap(
  credential: string,
  uploads: UploadMap,
  twelveC: TwelveCClient,
): Uint8Array {
  return twelveC.receiveFromUploadMap(credential, uploads);
}
