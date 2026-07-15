import type { TransferConfig } from './config/transfer-config.js';
import type { UploadMap } from './types.js';

/** 保守档：移动端 / 小文件 / 弱网。 */
export const WIRE_BLOCK_BYTES_16_MIB = 16 * 1024 * 1024;

/** 加速档：桌面大文件 + Relay 支持时。 */
export const WIRE_BLOCK_BYTES_32_MIB = 32 * 1024 * 1024;

/** Registry / Relay 默认部署上限。 */
export const DEFAULT_RELAY_MAX_BODY_BYTES = WIRE_BLOCK_BYTES_32_MIB;

/** 明文达到此大小时，非移动环境可选用 32 MiB 档。 */
export const LARGE_FILE_WIRE_BLOCK_THRESHOLD_BYTES = 128 * 1024 * 1024;

export interface ChooseEffectiveWireBlockBytesOptions {
  fileSizeBytes: number;
  relayMaxBodyBytes?: number;
  /** 强制保守档（设置页 / 测试）。 */
  preferConservative?: boolean;
  /** 覆盖 UA 检测。 */
  isMobile?: boolean;
}

export function isLikelyMobileBrowser(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }
  const uaData = (
    navigator as Navigator & { userAgentData?: { mobile?: boolean } }
  ).userAgentData;
  if (uaData?.mobile === true) {
    return true;
  }
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

/**
 * 应用策略档（不含 Relay 硬顶）。
 * - 明文 < 128 MiB → 16 MiB
 * - 移动 UA / preferConservative → 16 MiB
 * - 否则 → 32 MiB
 */
export function choosePolicyWireBlockBytes(
  options: ChooseEffectiveWireBlockBytesOptions,
): number {
  if (!Number.isFinite(options.fileSizeBytes) || options.fileSizeBytes < 0) {
    throw new Error('fileSizeBytes must be a non-negative finite number');
  }

  const mobile =
    options.isMobile === true ||
    (options.isMobile !== false && isLikelyMobileBrowser());

  if (
    options.preferConservative === true ||
    mobile ||
    options.fileSizeBytes < LARGE_FILE_WIRE_BLOCK_THRESHOLD_BYTES
  ) {
    return WIRE_BLOCK_BYTES_16_MIB;
  }

  return WIRE_BLOCK_BYTES_32_MIB;
}

export function resolveRelayMaxBodyBytes(config: TransferConfig): number {
  const value = config.relay?.maxBodyBytes;
  if (value === undefined) {
    return DEFAULT_RELAY_MAX_BODY_BYTES;
  }
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('relay.maxBodyBytes must be a positive finite number');
  }
  return Math.trunc(value);
}

/**
 * 有效 wire 块上限 = min(Relay 广播上限, 策略档)。
 */
export function resolveEffectiveWireBlockBytes(
  options: ChooseEffectiveWireBlockBytesOptions,
): number {
  const relayMax = options.relayMaxBodyBytes ?? DEFAULT_RELAY_MAX_BODY_BYTES;
  const policy = choosePolicyWireBlockBytes(options);
  return Math.min(relayMax, policy);
}

/** UploadMap 中是否存在超过 16 MiB 的 wire 块（说明走了 32 MiB 布局档）。 */
export function uploadMapUses32MiBWireBlocks(uploads: UploadMap): boolean {
  for (const blob of uploads.values()) {
    if (blob.byteLength > WIRE_BLOCK_BYTES_16_MIB) {
      return true;
    }
  }
  return false;
}

/** 本次上传是否按 32 MiB 档布局（显式 wireBlockBytes 优先，否则看块体积）。 */
export function resolveUploadUses32MiBWireBlocks(
  uploads: UploadMap,
  wireBlockBytes?: number,
): boolean {
  if (wireBlockBytes !== undefined) {
    return wireBlockBytes > WIRE_BLOCK_BYTES_16_MIB;
  }
  return uploadMapUses32MiBWireBlocks(uploads);
}
