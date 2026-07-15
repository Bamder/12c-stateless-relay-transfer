/** Emscripten 模块（由 build-wasm 生成） */
export interface TwelveCWasmUploadEntry {
  token: string;
  data: Uint8Array;
}

export interface TwelveCWasmUploadPrepareSession {
  feed(chunk: Uint8Array): void;
  takeReadyBlocks(): TwelveCWasmUploadEntry[];
  finalize(): TwelveCWasmUploadEntry;
}

export interface TwelveCWasmReceiveDecryptSession {
  addWireToken(tokenIndex: number, wireData: Uint8Array): void;
  finalize(): Uint8Array;
  completeFinalize(): void;
  plaintextByteLength(): number;
  paddedPlaintextLength(): number;
  originalFileLength(): number;
  takePlaintextChunk(maxBytes: number): Uint8Array;
}

export interface TwelveCWasmModule {
  prepareUpload(
    filePlaintext: Uint8Array,
    credential: string,
    originalFileName: string,
    segmentCode: number,
    maxWireBlockBytes: number,
  ): TwelveCWasmUploadEntry[];

  UploadPrepareSession: {
    feed(chunk: Uint8Array): void;
    takeReadyBlocks(): TwelveCWasmUploadEntry[];
    finalize(): TwelveCWasmUploadEntry;
  };

  createUploadPrepareSession(
    credential: string,
    originalFileName: string,
    filePlaintextSize: number,
    segmentCode: number,
    maxWireBlockBytes: number,
  ): TwelveCWasmUploadPrepareSession;

  ReceiveDecryptSession: {
    addWireToken(tokenIndex: number, wireData: Uint8Array): void;
    finalize(): Uint8Array;
    completeFinalize(): void;
    plaintextByteLength(): number;
    paddedPlaintextLength(): number;
    originalFileLength(): number;
    takePlaintextChunk(maxBytes: number): Uint8Array;
  };

  createReceiveDecryptSession(
    credential: string,
    token0Wire: Uint8Array,
  ): TwelveCWasmReceiveDecryptSession;

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
    segmentCode: number;
  };
}

export type CreateTwelveCModule = (options?: {
  locateFile?: (path: string, prefix: string) => string;
  wasmBinary?: ArrayBuffer;
}) => Promise<TwelveCWasmModule>;

declare const createTwelveCModule: CreateTwelveCModule;
export default createTwelveCModule;
