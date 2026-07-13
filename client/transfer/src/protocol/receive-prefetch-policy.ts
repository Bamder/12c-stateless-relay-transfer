import { DEFAULT_INITIAL_TOKENS } from '../types.js';
import { DEFAULT_RELAY_MAX_BODY_BYTES } from '../wire-block-policy.js';

/**
 * 浏览器接收侧在途 wire 块的目标内存预算（仅计已发出 GET、尚未喂给解密的块）。
 * 与 12C Π_Recv_Adaptive 的 initial_tokens = m 对应：m ≈ budget / wireBlockSize。
 */
export const DEFAULT_BROWSER_RECEIVE_MEMORY_BUDGET_BYTES = 96 * 1024 * 1024;

export const MIN_BROWSER_RECEIVE_PREFETCH = 2;
export const MAX_BROWSER_RECEIVE_PREFETCH = 64;

function isBrowserRuntime(): boolean {
  return typeof globalThis !== 'undefined' && 'window' in globalThis;
}

export interface ResolveReceivePrefetchCountOptions {
  /** 显式 m（覆盖预算推导） */
  explicit?: number;
  memoryBudgetBytes?: number;
  min?: number;
  max?: number;
}

/**
 * 由 wire 块大小与内存预算推导并发预取数 m。
 * Token[0] 混在 [0, m) 中与 Token[1..m-1] 同时发出，不单独暴露元数据块。
 */
export function resolveBrowserReceivePrefetchCount(
  wireBlockBytes: number,
  options: ResolveReceivePrefetchCountOptions = {},
): number {
  if (options.explicit !== undefined) {
    return Math.max(1, Math.trunc(options.explicit));
  }

  const budget =
    options.memoryBudgetBytes ?? DEFAULT_BROWSER_RECEIVE_MEMORY_BUDGET_BYTES;
  const min = options.min ?? MIN_BROWSER_RECEIVE_PREFETCH;
  const max = options.max ?? MAX_BROWSER_RECEIVE_PREFETCH;

  if (!Number.isFinite(wireBlockBytes) || wireBlockBytes <= 0) {
    return min;
  }

  return Math.max(
    min,
    Math.min(max, Math.floor(budget / Math.trunc(wireBlockBytes))),
  );
}

/**
 * Π_Recv_Adaptive 的 m：浏览器按预算推导；原生/Worker 默认 64。
 * 解析 SMB 前用 relayMaxBodyBytes 估计 wire 块；解析后用实测 wireBlockSize 收紧。
 */
export function resolveReceivePrefetchCount(
  wireBlockBytes: number,
  options: ResolveReceivePrefetchCountOptions & {
    relayMaxBodyBytes?: number;
  } = {},
): number {
  const blockBytes =
    wireBlockBytes > 0
      ? wireBlockBytes
      : (options.relayMaxBodyBytes ?? DEFAULT_RELAY_MAX_BODY_BYTES);

  if (isBrowserRuntime()) {
    return resolveBrowserReceivePrefetchCount(blockBytes, options);
  }

  return options.explicit ?? DEFAULT_INITIAL_TOKENS;
}
