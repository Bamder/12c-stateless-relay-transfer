import {
  CREDENTIAL_LENGTH,
  downloadAdaptive,
  type DownloadAdaptiveResult,
  type DownloadStatusUpdate,
  type ReceiveTransport,
  type TwelveCClient,
} from '@stateless-relay/transfer';

export interface ReceiveFileDeps {
  twelveC: TwelveCClient;
  receiveTransport: ReceiveTransport;
}

export interface ReceiveFileOptions {
  /** Π_Recv_Adaptive 初始并发 m；省略时浏览器按内存预算推导 */
  initialTokens?: number;
  /** 解析 SMB 前估计 wire 块上限（registry relay.config） */
  relayMaxBodyBytes?: number;
  onStatus?: (status: DownloadStatusUpdate) => void;
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
    {
      initialTokens: options.initialTokens,
      relayMaxBodyBytes: options.relayMaxBodyBytes,
      onStatus: options.onStatus,
    },
  );
}
