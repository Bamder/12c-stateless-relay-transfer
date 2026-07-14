/// <reference lib="webworker" />

import type {
  UploadPrepareWorkerRequest,
  UploadPrepareWorkerResponse,
  UploadPrepareWorkerWireBlock,
} from './upload-prepare-worker-protocol.js';

interface WasmUploadPrepareSession {
  feed(chunk: Uint8Array): void;
  takeReadyBlocks(): UploadPrepareWorkerWireBlock[];
  finalize(): UploadPrepareWorkerWireBlock;
}

interface WasmModule {
  createUploadPrepareSession(
    credential: string,
    fileName: string,
    fileSize: number,
    segmentCode: number,
    maxWireBlockBytes: number,
  ): WasmUploadPrepareSession;
}

declare function createTwelveCModule(options?: {
  locateFile?: (path: string) => string;
}): Promise<WasmModule>;

const workerScope: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

let wasmModulePromise: Promise<WasmModule> | null = null;
let wasmScriptUrl = '';
let wasmBinaryUrl = '';
let session: WasmUploadPrepareSession | null = null;
let bytesFed = 0;

async function ensureWasmModule(): Promise<WasmModule> {
  if (!wasmModulePromise) {
    wasmModulePromise = (async () => {
      workerScope.importScripts(wasmScriptUrl);
      return createTwelveCModule({
        locateFile: (path) =>
          path.endsWith('.wasm') ? wasmBinaryUrl : path,
      });
    })();
  }
  return wasmModulePromise;
}

function postError(id: number, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const response: UploadPrepareWorkerResponse = { id, type: 'error', message };
  workerScope.postMessage(response);
}

function copyBlocks(blocks: UploadPrepareWorkerWireBlock[]): UploadPrepareWorkerWireBlock[] {
  return blocks.map((block) => ({
    token: block.token,
    data: new Uint8Array(block.data),
  }));
}

workerScope.onmessage = async (event: MessageEvent<UploadPrepareWorkerRequest>) => {
  const message = event.data;
  try {
    switch (message.type) {
      case 'init': {
        wasmScriptUrl = message.wasmScriptUrl;
        wasmBinaryUrl = message.wasmBinaryUrl;
        bytesFed = 0;
        const module = await ensureWasmModule();
        session = module.createUploadPrepareSession(
          message.credential,
          message.fileName,
          message.fileSize,
          message.segmentCode,
          message.maxWireBlockBytes,
        );
        const response: UploadPrepareWorkerResponse = {
          id: message.id,
          type: 'ok',
        };
        workerScope.postMessage(response);
        break;
      }
      case 'feed': {
        if (!session) {
          throw new Error('upload prepare worker session not initialized');
        }
        session.feed(message.chunk);
        bytesFed += message.chunk.length;
        const blocks = copyBlocks(session.takeReadyBlocks());
        const transferables = blocks.map((block) => block.data.buffer);
        const response: UploadPrepareWorkerResponse = {
          id: message.id,
          type: 'fed',
          bytesFed,
          blocks,
        };
        workerScope.postMessage(response, transferables);
        break;
      }
      case 'finalize': {
        if (!session) {
          throw new Error('upload prepare worker session not initialized');
        }
        const finalized = session.finalize();
        session = null;
        const block = {
          token: finalized.token,
          data: new Uint8Array(finalized.data),
        };
        const response: UploadPrepareWorkerResponse = {
          id: message.id,
          type: 'finalized',
          block,
        };
        workerScope.postMessage(response, [block.data.buffer]);
        break;
      }
      case 'dispose': {
        session = null;
        workerScope.close();
        break;
      }
      default: {
        const unknownType = (message as { type?: string }).type ?? 'unknown';
        throw new Error(`unsupported upload prepare worker request: ${unknownType}`);
      }
    }
  } catch (error) {
    postError(message.id, error);
  }
};

export {};
