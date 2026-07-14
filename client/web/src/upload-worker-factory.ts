import UploadPrepareWorker from '../../transfer/src/wasm/upload-prepare.worker.ts?worker';

export const UPLOAD_WASM_SCRIPT_URL = new URL(
  'wasm/twelve_c_cryptography.js',
  document.baseURI,
).toString();
export const UPLOAD_WASM_BINARY_URL = new URL(
  'wasm/twelve_c_cryptography.wasm',
  document.baseURI,
).toString();

export function createUploadPrepareWorker(): Worker {
  return new UploadPrepareWorker();
}
