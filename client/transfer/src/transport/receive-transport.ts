/** 12C 接收协议所需的最小传输端口（异步版，对应 C++ ReceiveTransport） */
export interface ReceiveTransport {
  startConcurrentGet(tokens: string[]): void;

  cancelPending(tokens: string[]): void;

  get(token: string): Promise<Uint8Array>;
}
