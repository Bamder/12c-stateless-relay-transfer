import { sleep } from './retry-policy.js';

/** 浏览器 Performance API 观测到的下一跳协议。 */
export type RelayHopProtocol = 'h2' | 'http/1.1' | 'unknown';

/**
 * 条带 primary 分阶段并发（已完成块数 → 允许并行上限）：
 * 0 → 1，1 → 2，2 → 4，≥3 → 6（再与 maxConcurrency 取 min）。
 */
export function resolveRampedStripeConcurrency(
  completedBlocks: number,
  maxConcurrency: number,
): number {
  const staged =
    completedBlocks >= 3 ? 6 : completedBlocks >= 2 ? 4 : completedBlocks >= 1 ? 2 : 1;
  return Math.min(maxConcurrency, staged);
}

function parseHopProtocol(raw: string | undefined): RelayHopProtocol {
  if (raw === undefined || raw.length === 0) {
    return 'unknown';
  }
  const normalized = raw.toLowerCase();
  if (normalized === 'h2' || normalized.includes('http/2')) {
    return 'h2';
  }
  if (normalized.includes('http/1')) {
    return 'http/1.1';
  }
  return 'unknown';
}

/**
 * 对 Relay 样本 URL 发轻量 HEAD，用 PerformanceResourceTiming 判断 HTTP/2。
 * 404/405 等仍可用于建连探测；失败时返回 `unknown`（保守走分阶段）。
 */
export async function detectRelayHopProtocol(
  sampleUrl: string,
  fetchFn: typeof fetch,
): Promise<RelayHopProtocol> {
  if (typeof performance === 'undefined') {
    return 'unknown';
  }

  const beforeCount = performance.getEntriesByType('resource').length;
  try {
    await fetchFn(sampleUrl, {
      method: 'HEAD',
      cache: 'no-store',
      mode: 'cors',
    });
  } catch {
    return 'unknown';
  }

  const entries = performance.getEntriesByType(
    'resource',
  ) as PerformanceResourceTiming[];
  for (let index = entries.length - 1; index >= beforeCount; index--) {
    const entry = entries[index];
    if (entry === undefined) {
      continue;
    }
    if (entry.name === sampleUrl || entry.name.startsWith(sampleUrl)) {
      return parseHopProtocol(entry.nextHopProtocol);
    }
  }

  const last = entries[entries.length - 1];
  return parseHopProtocol(last?.nextHopProtocol);
}

export interface ResolveStripeRampConcurrencyOptions {
  relayCount?: number;
  /** 显式开关；省略时按 Relay 数量与 HTTP 版本推断。 */
  explicit?: boolean;
  hopProtocol: RelayHopProtocol;
  /** 仅 32 MiB 档块触发分阶段；16 MiB 块直接全速。 */
  uses32MiBWireBlocks: boolean;
  isBrowser?: boolean;
}

/**
 * 是否对条带 primary 启用分阶段升并发。
 * - 16 MiB 块：否
 * - 多 Relay：否（条带已分散）
 * - HTTP/2：否（多路复用，无需保守起步）
 * - 单 Relay + HTTP/1.1/unknown + 浏览器 + 32 MiB 块：是
 */
export function resolveStripeRampConcurrency(
  options: ResolveStripeRampConcurrencyOptions,
): boolean {
  if (options.explicit !== undefined) {
    return options.explicit;
  }

  if (!options.uses32MiBWireBlocks) {
    return false;
  }

  if (options.relayCount !== undefined && options.relayCount > 1) {
    return false;
  }

  const browser = options.isBrowser ?? isBrowserRuntime();
  if (!browser) {
    return false;
  }

  return options.hopProtocol !== 'h2';
}

function isBrowserRuntime(): boolean {
  return typeof globalThis !== 'undefined' && 'window' in globalThis;
}

const RAMP_SLOT_POLL_MS = 16;

/** 分阶段并发下等待可用 worker 槽位。 */
export async function waitForStripePutSlot(
  inFlight: () => number,
  completed: () => number,
  maxConcurrency: number,
  rampConcurrency: boolean,
): Promise<void> {
  while (true) {
    const limit = rampConcurrency
      ? resolveRampedStripeConcurrency(completed(), maxConcurrency)
      : maxConcurrency;
    if (inFlight() < limit) {
      return;
    }
    await sleep(RAMP_SLOT_POLL_MS);
  }
}
