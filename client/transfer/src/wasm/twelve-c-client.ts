import type { SmbMetadata, UploadMap } from '../types.js';

/**
 * 12C 密码学层（WASM）最小接口。
 * 实现由 Emscripten 构建的 twelve_c_cryptography 提供。
 */
export interface TwelveCClient {
  prepareUpload(
    filePlaintext: Uint8Array,
    credential: string,
    originalFileName?: string,
  ): UploadMap;

  receiveFromUploadMap(credential: string, uploads: UploadMap): Uint8Array;

  deriveUploadToken(searchCode: string, index: number): string;

  parseSmbEncrypted(credential: string, smbEncrypted: Uint8Array): SmbMetadata;
}
