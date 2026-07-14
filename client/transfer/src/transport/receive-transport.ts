/** 12C 接收协议所需的最小传输端口（异步版，对应 C++ ReceiveTransport） */
export interface ReceiveTransport {
  /** Kick off concurrent GETs; may return a Promise when resolve must finish first. */
  startConcurrentGet(tokens: string[]): void | Promise<void>;

  cancelPending(tokens: string[]): void;

  get(token: string): Promise<Uint8Array>;

  /** Tokens currently resolving routes or fetching wire bodies. */
  inFlightCount?(): number;
}
