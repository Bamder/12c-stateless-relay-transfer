import type { UploadWireBlock } from './twelve-c-client.js';
import type {
  UploadPrepareWorkerRequest,
  UploadPrepareWorkerResponse,
  UploadPrepareWorkerWireBlock,
} from './upload-prepare-worker-protocol.js';

export interface UploadPrepareWorkerInitOptions {
  wasmScriptUrl: string;
  wasmBinaryUrl: string;
  credential: string;
  fileName: string;
  fileSize: number;
  segmentCode: number;
  maxWireBlockBytes: number;
}

export interface UploadPrepareWorkerFeedResult {
  bytesFed: number;
  blocks: UploadWireBlock[];
}

function wireBlocksFromWorker(
  blocks: UploadPrepareWorkerWireBlock[],
): UploadWireBlock[] {
  return blocks.map((block) => ({
    token: block.token,
    data: new Uint8Array(block.data),
  }));
}

export class UploadPrepareWorkerClient {
  private readonly worker: Worker;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    {
      resolve: (value: UploadPrepareWorkerResponse) => void;
      reject: (error: Error) => void;
    }
  >();
  private disposed = false;

  constructor(worker: Worker) {
    this.worker = worker;
    worker.onmessage = (event: MessageEvent<UploadPrepareWorkerResponse>) => {
      const message = event.data;
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      this.pending.delete(message.id);
      if (message.type === 'error') {
        pending.reject(new Error(message.message));
        return;
      }
      pending.resolve(message);
    };
    worker.onerror = (event) => {
      this.rejectAll(new Error(event.message || 'upload prepare worker failed'));
    };
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }

  private request(
    request: UploadPrepareWorkerRequest,
    transfer?: Transferable[],
  ): Promise<UploadPrepareWorkerResponse> {
    if (this.disposed) {
      return Promise.reject(new Error('upload prepare worker already disposed'));
    }
    const id = this.nextId++;
    const payload = { ...request, id } as UploadPrepareWorkerRequest;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage(payload, transfer ?? []);
    });
  }

  async init(options: UploadPrepareWorkerInitOptions): Promise<void> {
    const response = await this.request({
      id: 0,
      type: 'init',
      wasmScriptUrl: options.wasmScriptUrl,
      wasmBinaryUrl: options.wasmBinaryUrl,
      credential: options.credential,
      fileName: options.fileName,
      fileSize: options.fileSize,
      segmentCode: options.segmentCode,
      maxWireBlockBytes: options.maxWireBlockBytes,
    });
    if (response.type !== 'ok') {
      throw new Error(`unexpected upload prepare worker init response: ${response.type}`);
    }
  }

  async feed(chunk: Uint8Array): Promise<UploadPrepareWorkerFeedResult> {
    const payload = chunk.slice();
    const response = await this.request(
      { id: 0, type: 'feed', chunk: payload },
      [payload.buffer],
    );
    if (response.type !== 'fed') {
      throw new Error(`unexpected upload prepare worker feed response: ${response.type}`);
    }
    return {
      bytesFed: response.bytesFed,
      blocks: wireBlocksFromWorker(response.blocks),
    };
  }

  async finalize(): Promise<UploadWireBlock> {
    const response = await this.request({ id: 0, type: 'finalize' });
    if (response.type !== 'finalized') {
      throw new Error(
        `unexpected upload prepare worker finalize response: ${response.type}`,
      );
    }
    return wireBlocksFromWorker([response.block])[0]!;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.rejectAll(new Error('upload prepare worker disposed'));
    this.worker.postMessage({
      id: this.nextId++,
      type: 'dispose',
    } satisfies UploadPrepareWorkerRequest);
    this.worker.terminate();
  }
}

export function canUseUploadPrepareWorker(
  createWorker?: () => Worker,
): boolean {
  if (typeof Worker === 'undefined') {
    return false;
  }
  if (createWorker !== undefined) {
    return true;
  }
  return typeof import.meta.url === 'string';
}

export function createDefaultUploadPrepareWorker(): Worker {
  return new Worker(
    new URL('./upload-prepare.worker.ts', import.meta.url),
    { type: 'classic' },
  );
}
