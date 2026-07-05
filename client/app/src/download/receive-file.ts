import {
  CREDENTIAL_LENGTH,
  downloadAdaptive,
  type DownloadAdaptiveResult,
  type ReceiveTransport,
  type TwelveCClient,
} from '@stateless-relay/transfer';

export interface ReceiveFileDeps {
  twelveC: TwelveCClient;
  receiveTransport: ReceiveTransport;
}

export interface ReceiveFileOptions {
  /** 初始并发预取 token 数，默认与 `downloadAdaptive` 相同 */
  initialTokens?: number;
}

export type ReceivedFile = DownloadAdaptiveResult;

/**
 * 应用层接收：凭带外 credential 从 relay 自适应下载并解密为明文。
 */
export async function receiveFile(
  credential: string,
  deps: ReceiveFileDeps,
  options: ReceiveFileOptions = {},
): Promise<ReceivedFile> {
  if (credential.length !== CREDENTIAL_LENGTH) {
    throw new Error(`credential must be exactly ${CREDENTIAL_LENGTH} characters`);
  }

  return downloadAdaptive(
    credential,
    deps.receiveTransport,
    deps.twelveC,
    { initialTokens: options.initialTokens },
  );
}
