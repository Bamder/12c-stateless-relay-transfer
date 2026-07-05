import {
  RegistryTokenOccupiedError,
  uploadFile,
  type FetchUploadClient,
  type OccupiedTokenInfo,
  type RegistryClient,
  type RelayRouter,
  type TwelveCClient,
  type UploadMap,
  type UploadProgress,
} from '@stateless-relay/transfer';
import { generateCredential } from '../credential/generate-credential.js';
import { UploadTokenReservationExhaustedError } from './upload-token-reservation-exhausted-error.js';

export const DEFAULT_MAX_RESERVATION_ATTEMPTS = 5;

export interface SendFileDeps {
  twelveC: TwelveCClient;
  registry: RegistryClient;
  router: RelayRouter;
  uploadClient: FetchUploadClient;
}

export interface SendFileOptions {
  /** 并发 PUT 上限 */
  concurrency?: number;
  /** token 占用时最多重试次数（含首次），默认 5 */
  maxReservationAttempts?: number;
  onProgress?: (progress: UploadProgress) => void;
  /** 每次因 409 重新生成凭证时回调 */
  onReservationRetry?: (info: {
    attempt: number;
    maxAttempts: number;
    occupiedTokens: readonly OccupiedTokenInfo[];
  }) => void;
}

export interface SendFileResult {
  /** 本次成功上传使用的带外凭证，需交给接收方 */
  credential: string;
  uploads: UploadMap;
  /** replica 后台补传；失败时会通知 Registry 清理 placement */
  replicaSync?: Promise<void>;
}

/**
 * 应用层发送：随机生成 12C 凭证 → 加密上传。
 * reserve 409 → 换整包凭证重试（默认最多 5 次）。
 * Relay PUT 失败 → `uploadFile` 内同凭证块级重传（见 `putMaxAttempts`）。
 */
export async function sendFile(
  filePlaintext: Uint8Array,
  deps: SendFileDeps,
  options: SendFileOptions = {},
): Promise<SendFileResult> {
  const maxAttempts = options.maxReservationAttempts ?? DEFAULT_MAX_RESERVATION_ATTEMPTS;
  if (maxAttempts <= 0) {
    throw new Error('maxReservationAttempts must be greater than zero');
  }

  let lastOccupiedTokens: OccupiedTokenInfo[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const credential = generateCredential();

    try {
      const { uploads, replicaSync } = await uploadFile(
        filePlaintext,
        credential,
        deps.twelveC,
        deps.router,
        deps.uploadClient,
        {
          registry: deps.registry,
          concurrency: options.concurrency,
        },
        options.onProgress,
      );

      return { credential, uploads, replicaSync };
    } catch (error) {
      if (!(error instanceof RegistryTokenOccupiedError)) {
        throw error;
      }

      lastOccupiedTokens = error.occupiedTokens;
      options.onReservationRetry?.({
        attempt,
        maxAttempts,
        occupiedTokens: error.occupiedTokens,
      });

      if (attempt < maxAttempts) {
        continue;
      }
    }
  }

  throw new UploadTokenReservationExhaustedError(maxAttempts, lastOccupiedTokens);
}
