import type { UploadMap } from '../types.js';
import type { BlockHashEntry } from './block-hash.js';
import { computeBlockHashSha256 } from './block-hash.js';

export const DEFAULT_BLOCK_HASH_CONCURRENCY = 12;

export interface BlockHashPoolOptions {
  concurrency?: number;
  onProgress?: (completed: number, total: number) => void;
}

/**
 * 块到达即入队哈希；与上游加密并行，finalize 后 drain 得到 reserve 所需条目。
 */
export class BlockHashPool {
  private readonly concurrency: number;
  private readonly onProgress?: (completed: number, total: number) => void;
  private readonly results = new Map<string, string>();
  private readonly queue: Array<{ token: string; data: Uint8Array }> = [];
  private inFlight = 0;
  private completed = 0;
  private totalEnqueued = 0;
  private readonly drainWaiters: Array<() => void> = [];
  private closed = false;

  constructor(options: BlockHashPoolOptions = {}) {
    const concurrency = options.concurrency ?? DEFAULT_BLOCK_HASH_CONCURRENCY;
    if (concurrency <= 0) {
      throw new Error('block hash concurrency must be greater than zero');
    }
    this.concurrency = concurrency;
    this.onProgress = options.onProgress;
  }

  enqueue(token: string, data: Uint8Array): void {
    if (this.closed) {
      throw new Error('block hash pool is closed');
    }
    this.totalEnqueued++;
    this.queue.push({ token, data });
    this.pump();
  }

  private pump(): void {
    while (this.inFlight < this.concurrency && this.queue.length > 0) {
      const job = this.queue.shift()!;
      this.inFlight++;
      void this.runJob(job);
    }
  }

  private async runJob(job: { token: string; data: Uint8Array }): Promise<void> {
    try {
      const blockHash = await computeBlockHashSha256(job.data);
      this.results.set(job.token, blockHash);
    } finally {
      this.inFlight--;
      this.completed++;
      this.onProgress?.(this.completed, this.totalEnqueued);
      this.pump();
      this.maybeResolveDrain();
    }
  }

  private maybeResolveDrain(): void {
    if (!this.closed) {
      return;
    }
    if (this.completed < this.totalEnqueued || this.inFlight > 0) {
      return;
    }
    for (const resolve of this.drainWaiters.splice(0)) {
      resolve();
    }
  }

  close(): void {
    this.closed = true;
    this.maybeResolveDrain();
  }

  async drain(): Promise<BlockHashEntry[]> {
    this.close();
    if (this.completed < this.totalEnqueued || this.inFlight > 0) {
      await new Promise<void>((resolve) => this.drainWaiters.push(resolve));
    }
    return [...this.results.entries()].map(([token, blockHash]) => ({
      token,
      blockHash,
    }));
  }
}

export async function computeUploadBlockHashesParallel(
  uploads: UploadMap,
  options: {
    concurrency?: number;
    onProgress?: (completed: number, total: number) => void;
  } = {},
): Promise<BlockHashEntry[]> {
  const pool = new BlockHashPool(options);
  for (const [token, data] of uploads) {
    pool.enqueue(token, data);
  }
  return pool.drain();
}
