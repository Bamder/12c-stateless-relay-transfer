export interface UploadPrepareWorkerWireBlock {
  token: string;
  data: Uint8Array;
}

export type UploadPrepareWorkerRequest =
  | {
      id: number;
      type: 'init';
      wasmScriptUrl: string;
      wasmBinaryUrl: string;
      credential: string;
      fileName: string;
      fileSize: number;
      segmentCode: number;
      maxWireBlockBytes: number;
    }
  | { id: number; type: 'feed'; chunk: Uint8Array }
  | { id: number; type: 'finalize' }
  | { id: number; type: 'dispose' };

export type UploadPrepareWorkerResponse =
  | { id: number; type: 'ok' }
  | {
      id: number;
      type: 'fed';
      bytesFed: number;
      blocks: UploadPrepareWorkerWireBlock[];
    }
  | { id: number; type: 'finalized'; block: UploadPrepareWorkerWireBlock }
  | { id: number; type: 'error'; message: string };

export const DEFAULT_UPLOAD_WASM_SCRIPT_URL = '/wasm/twelve_c_cryptography.js';
export const DEFAULT_UPLOAD_WASM_BINARY_URL = '/wasm/twelve_c_cryptography.wasm';
