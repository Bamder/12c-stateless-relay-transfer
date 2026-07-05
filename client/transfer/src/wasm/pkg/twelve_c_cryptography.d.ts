/** Emscripten 模块（由 build-wasm 生成） */
export interface TwelveCWasmUploadEntry {
  token: string;
  data: Uint8Array;
}

export interface TwelveCWasmModule {
  prepareUpload(
    filePlaintext: Uint8Array,
    credential: string,
    originalFileName?: string,
  ): TwelveCWasmUploadEntry[];

  receiveFromUploadMap(
    credential: string,
    entries: TwelveCWasmUploadEntry[],
  ): Uint8Array;

  deriveUploadToken(searchCode: string, index: number): string;

  parseSmbEncrypted(
    credential: string,
    smbEncrypted: Uint8Array,
  ): {
    numTokens: number;
    wireBlockSize: number;
    ciphertextLength: number;
    originalFileLength: number;
    originalFileName: string;
  };
}

export type CreateTwelveCModule = (options?: {
  locateFile?: (path: string, prefix: string) => string;
  wasmBinary?: ArrayBuffer;
}) => Promise<TwelveCWasmModule>;

declare const createTwelveCModule: CreateTwelveCModule;
export default createTwelveCModule;
