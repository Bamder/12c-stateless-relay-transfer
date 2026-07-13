import type { ReceiveDecryptSession } from '../wasm/twelve-c-client.js';
import { byteLengthsEqual, toSafeByteLength } from '../types.js';

/** 从 WASM 分块取最终文件明文（C++ 已做流式 prefix strip） */
export const RECEIVE_PLAINTEXT_EXPORT_CHUNK_BYTES = 4 * 1024 * 1024;

function yieldToBrowser(): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(() => resolve(), 0);
  });
}

/**
 * 单块目标缓冲区：每段只拷贝一次，避免 parts[] 堆积整文件导致 JS 堆 OOM。
 */
export class ReceivePlaintextAccumulator {
  private offset = 0;

  constructor(
    private readonly buffer: Uint8Array<ArrayBuffer>,
    private readonly expectedLength: number,
  ) {}

  get bytesWritten(): number {
    return this.offset;
  }

  async drainSession(session: ReceiveDecryptSession): Promise<void> {
    const takeChunk = session.takePlaintextChunk;
    if (takeChunk === undefined) {
      return;
    }

    let chunkCount = 0;
    while (true) {
      const chunk = takeChunk.call(session, RECEIVE_PLAINTEXT_EXPORT_CHUNK_BYTES);
      if (chunk.length === 0) {
        break;
      }

      if (this.offset + chunk.length > this.buffer.length) {
        throw new Error(
          `decrypted file overflow: wrote ${this.offset + chunk.length} bytes, ` +
            `buffer capacity ${this.buffer.length}`,
        );
      }

      this.buffer.set(chunk, this.offset);
      this.offset += chunk.length;
      chunkCount += 1;
      if (chunkCount % 4 === 0) {
        await yieldToBrowser();
      }
    }
  }

  toBlob(): Blob {
    if (!byteLengthsEqual(this.offset, this.expectedLength)) {
      throw new Error(
        `decrypted file size mismatch: got ${this.offset}, ` +
          `expected ${this.expectedLength}`,
      );
    }
    return new Blob([this.buffer], { type: 'application/octet-stream' });
  }
}

export function createReceivePlaintextAccumulator(
  expectedLength: number,
): ReceivePlaintextAccumulator {
  const safeExpectedLength = toSafeByteLength(
    expectedLength,
    'expectedPlaintextLength',
  );

  try {
    const buffer = new Uint8Array(safeExpectedLength) as Uint8Array<ArrayBuffer>;
    return new ReceivePlaintextAccumulator(buffer, safeExpectedLength);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `无法为解密结果分配 ${safeExpectedLength} 字节（${detail}）。` +
        '请关闭其他标签页后重试，或尝试较小文件。',
      { cause: error },
    );
  }
}

function copyChunk(chunk: Uint8Array | ArrayLike<number>): Uint8Array<ArrayBuffer> {
  const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy;
}

/** @deprecated 大文件请用 ReceivePlaintextAccumulator */
export async function drainReadyPlaintextParts(
  session: ReceiveDecryptSession,
  parts: Uint8Array<ArrayBuffer>[],
): Promise<void> {
  const takeChunk = session.takePlaintextChunk;
  if (takeChunk === undefined) {
    return;
  }

  let chunkCount = 0;
  while (true) {
    const chunk = copyChunk(takeChunk.call(session, RECEIVE_PLAINTEXT_EXPORT_CHUNK_BYTES));
    if (chunk.length === 0) {
      break;
    }
    parts.push(chunk);
    chunkCount += 1;
    if (chunkCount % 4 === 0) {
      await yieldToBrowser();
    }
  }
}

/**
 * Merkle 校验通过后分块取出明文。V2.1 大文件应在每块 addWireToken 后 drain，
 * completeFinalize 后再 drain 剩余。
 */
export async function finalizeReceiveDecryptToBlob(
  session: ReceiveDecryptSession,
  sink: ReceivePlaintextAccumulator,
): Promise<Blob>;
export async function finalizeReceiveDecryptToBlob(
  session: ReceiveDecryptSession,
  parts?: Uint8Array<ArrayBuffer>[],
): Promise<Blob>;
export async function finalizeReceiveDecryptToBlob(
  session: ReceiveDecryptSession,
  sink: ReceivePlaintextAccumulator | Uint8Array<ArrayBuffer>[] = [],
): Promise<Blob> {
  if (typeof session.completeFinalize !== 'function') {
    return new Blob([copyChunk(session.finalize())], {
      type: 'application/octet-stream',
    });
  }

  session.completeFinalize();

  if (sink instanceof ReceivePlaintextAccumulator) {
    await sink.drainSession(session);
    return sink.toBlob();
  }

  const parts = sink;
  await drainReadyPlaintextParts(session, parts);

  const expectedLength = session.originalFileLength?.();
  if (expectedLength !== undefined) {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    if (!byteLengthsEqual(total, expectedLength)) {
      throw new Error(
        `decrypted file size mismatch: got ${total}, expected ${expectedLength}`,
      );
    }
  }

  return new Blob(parts, { type: 'application/octet-stream' });
}
