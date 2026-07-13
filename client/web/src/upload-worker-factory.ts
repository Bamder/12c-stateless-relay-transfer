import UploadPrepareWorker from '../../transfer/src/wasm/upload-prepare.worker.ts?worker';

export const UPLOAD_WASM_SCRIPT_URL = '/wasm/twelve_c_cryptography.js';
export const UPLOAD_WASM_BINARY_URL = '/wasm/twelve_c_cryptography.wasm';

export function createUploadPrepareWorker(): Worker {
  return new UploadPrepareWorker();
}
