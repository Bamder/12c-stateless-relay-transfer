import { DEFAULT_INITIAL_TOKENS, splitCredential, type UploadMap } from '../types.js';
import type { TwelveCClient } from '../wasm/twelve-c-client.js';
import type { ReceiveTransport } from '../transport/receive-transport.js';
import {
  computeReceiveDownloadPlan,
  deriveIndexTokens,
} from '../protocol/receive-plan.js';
import { resolveReceivedFileName } from '../protocol/received-file-name.js';

export interface DownloadSessionOptions {
  /** 初始并发预取 token 数，默认 64 */
  initialTokens?: number;
}

export interface DownloadAdaptiveResult {
  data: Uint8Array;
  fileName: string;
}

/**
 * Π_Recv_Adaptive：预设并发 + SMB 优先 + 动态扩缩/中止，完成后委托 WASM 解密。
 */
export async function downloadAdaptive(
  credential: string,
  transport: ReceiveTransport,
  twelveC: TwelveCClient,
  options: DownloadSessionOptions = {},
): Promise<DownloadAdaptiveResult> {
  const initialTokens = options.initialTokens ?? DEFAULT_INITIAL_TOKENS;
  if (initialTokens <= 0) {
    throw new Error('initial token count must be greater than zero');
  }

  const { searchCode } = splitCredential(credential);

  const initialPrefetch = deriveIndexTokens(twelveC, searchCode, 0, initialTokens);
  transport.startConcurrentGet(initialPrefetch);

  const token0 = twelveC.deriveUploadToken(searchCode, 0);
  const token0Wire = await transport.get(token0);
  const metadata = twelveC.parseSmbEncrypted(credential, token0Wire);
  const fileName = resolveReceivedFileName(metadata.originalFileName, credential);

  const plan = computeReceiveDownloadPlan(
    twelveC,
    searchCode,
    initialTokens,
    metadata.numTokens,
  );

  if (plan.fetchAfterSmb.length > 0) {
    transport.startConcurrentGet(plan.fetchAfterSmb);
  }
  if (plan.cancelAfterSmb.length > 0) {
    transport.cancelPending(plan.cancelAfterSmb);
  }

  const uploads: UploadMap = new Map([[token0, token0Wire]]);

  for (let tokenIndex = 1; tokenIndex < metadata.numTokens; tokenIndex++) {
    const token = twelveC.deriveUploadToken(searchCode, tokenIndex);
    uploads.set(token, await transport.get(token));
  }

  return {
    data: twelveC.receiveFromUploadMap(credential, uploads),
    fileName,
  };
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
