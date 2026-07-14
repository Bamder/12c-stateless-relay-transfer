import { DEFAULT_INITIAL_TOKENS } from '../types.js';
import {
  DEFAULT_RELAY_MAX_BODY_BYTES,
  isLikelyMobileBrowser,
} from '../wire-block-policy.js';

/**
 * Fallback in-flight wire-block budget when device memory cannot be probed.
 * Only counts issued GETs not yet fed into decrypt.
 */
export const DEFAULT_BROWSER_RECEIVE_MEMORY_BUDGET_BYTES = 96 * 1024 * 1024;

/** Conservative fallback when UA looks mobile and deviceMemory is missing. */
export const MOBILE_BROWSER_RECEIVE_MEMORY_BUDGET_BYTES = 48 * 1024 * 1024;

export const MIN_BROWSER_RECEIVE_MEMORY_BUDGET_BYTES = 32 * 1024 * 1024;
export const MAX_BROWSER_RECEIVE_MEMORY_BUDGET_BYTES = 192 * 1024 * 1024;
/** Mobile hard cap even on high deviceMemory readings. */
export const MAX_MOBILE_BROWSER_RECEIVE_MEMORY_BUDGET_BYTES = 64 * 1024 * 1024;

export const MIN_BROWSER_RECEIVE_PREFETCH = 2;
export const MAX_BROWSER_RECEIVE_PREFETCH = 64;

function isBrowserRuntime(): boolean {
  return typeof globalThis !== 'undefined' && 'window' in globalThis;
}

function readNavigatorDeviceMemoryGiB(): number | undefined {
  if (typeof navigator === 'undefined') {
    return undefined;
  }
  const value = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return value;
}

export interface ProbeReceiveMemoryBudgetOptions {
  /** Override navigator.deviceMemory (GiB). */
  deviceMemoryGiB?: number;
  /** Override mobile UA detection. */
  isMobile?: boolean;
}

/**
 * Probe a receive-side memory budget from approximate device RAM.
 *
 * Uses navigator.deviceMemory when present (Chromium). Otherwise falls back to
 * 96 MiB desktop / 48 MiB mobile. Mobile is additionally capped at 64 MiB.
 */
export function probeBrowserReceiveMemoryBudgetBytes(
  options: ProbeReceiveMemoryBudgetOptions = {},
): number {
  const mobile =
    options.isMobile === true ||
    (options.isMobile !== false && isLikelyMobileBrowser());
  const deviceMemoryGiB =
    options.deviceMemoryGiB ?? readNavigatorDeviceMemoryGiB();

  let budget: number;
  if (deviceMemoryGiB === undefined) {
    budget = mobile
      ? MOBILE_BROWSER_RECEIVE_MEMORY_BUDGET_BYTES
      : DEFAULT_BROWSER_RECEIVE_MEMORY_BUDGET_BYTES;
  } else if (deviceMemoryGiB <= 1) {
    budget = 32 * 1024 * 1024;
  } else if (deviceMemoryGiB <= 2) {
    budget = 48 * 1024 * 1024;
  } else if (deviceMemoryGiB <= 4) {
    budget = 96 * 1024 * 1024;
  } else if (deviceMemoryGiB <= 8) {
    budget = 128 * 1024 * 1024;
  } else {
    budget = 192 * 1024 * 1024;
  }

  if (mobile) {
    budget = Math.min(budget, MAX_MOBILE_BROWSER_RECEIVE_MEMORY_BUDGET_BYTES);
  }

  return Math.max(
    MIN_BROWSER_RECEIVE_MEMORY_BUDGET_BYTES,
    Math.min(MAX_BROWSER_RECEIVE_MEMORY_BUDGET_BYTES, budget),
  );
}

export interface ResolveReceivePrefetchCountOptions {
  /** Explicit m (skips budget derivation). */
  explicit?: number;
  memoryBudgetBytes?: number;
  min?: number;
  max?: number;
  deviceMemoryGiB?: number;
  isMobile?: boolean;
}

/**
 * Derive concurrent prefetch count m from wire-block size and a memory budget.
 * Token[0] shares the [0, m) window with Token[1..m-1].
 */
export function resolveBrowserReceivePrefetchCount(
  wireBlockBytes: number,
  options: ResolveReceivePrefetchCountOptions = {},
): number {
  if (options.explicit !== undefined) {
    return Math.max(1, Math.trunc(options.explicit));
  }

  const budget =
    options.memoryBudgetBytes ??
    probeBrowserReceiveMemoryBudgetBytes({
      deviceMemoryGiB: options.deviceMemoryGiB,
      isMobile: options.isMobile,
    });
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
 * Π_Recv_Adaptive m: browsers probe a budget; native/Worker default to 64.
 * Before SMB parse, estimate wire size with relayMaxBodyBytes; after parse,
 * retighten with measured wireBlockSize.
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
