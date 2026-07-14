import type { SmbMetadata, UploadMap } from '../types.js';

export interface UploadWireBlock {
  token: string;
  data: Uint8Array;
}

export interface UploadPrepareSession {
  feed(chunk: Uint8Array): void;
  takeReadyBlocks(): UploadWireBlock[];
  finalize(): UploadWireBlock;
}

/**
 * 12C 密码学层（WASM）最小接口。
 * 实现由 Emscripten 构建的 twelve_c_cryptography 提供。
 */
export interface ReceiveDecryptSession {
  addWireToken(tokenIndex: number, wireData: Uint8Array): void;
  finalize(): Uint8Array;
  completeFinalize?(): void;
  takePlaintextChunk?(maxBytes: number): Uint8Array;
  paddedPlaintextLength?(): number | undefined;
  originalFileLength?(): number | undefined;
}

export interface TwelveCClient {
  prepareUpload(
    filePlaintext: Uint8Array,
    credential: string,
    originalFileName: string | undefined,
    segmentCode: number,
    maxWireBlockBytes: number,
  ): UploadMap;

  createUploadPrepareSession(
    credential: string,
    originalFileName: string | undefined,
    filePlaintextSize: number,
    segmentCode: number,
    maxWireBlockBytes: number,
  ): UploadPrepareSession;

  createReceiveDecryptSession(
    credential: string,
    token0Wire: Uint8Array,
  ): ReceiveDecryptSession;

  receiveFromUploadMap(credential: string, uploads: UploadMap): Uint8Array;

  deriveUploadToken(searchCode: string, index: number): string;

  parseSmbEncrypted(credential: string, smbEncrypted: Uint8Array): SmbMetadata;
}
