export const MAX_FILE_TTL_SECONDS = 24 * 60 * 60;
export const DEFAULT_FILE_TTL_SECONDS = 3600;

/** 发送页滑块可用的常用有效期（秒） */
export const FILE_TTL_PRESETS_SECONDS = [
  5 * 60,
  10 * 60,
  15 * 60,
  20 * 60,
  30 * 60,
  60 * 60,
  2 * 60 * 60,
  4 * 60 * 60,
  6 * 60 * 60,
  12 * 60 * 60,
  18 * 60 * 60,
  24 * 60 * 60,
] as const;

export interface DurationParts {
  hours: number;
  minutes: number;
  seconds: number;
  totalSeconds: number;
}

export function nearestFileTtlPresetIndex(totalSeconds: number): number {
  const safe = Number.isFinite(totalSeconds)
    ? Math.max(0, Math.trunc(totalSeconds))
    : DEFAULT_FILE_TTL_SECONDS;
  let bestIndex = 0;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (let i = 0; i < FILE_TTL_PRESETS_SECONDS.length; i++) {
    const diff = Math.abs(FILE_TTL_PRESETS_SECONDS[i]! - safe);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIndex = i;
    }
  }
  return bestIndex;
}

export function fileTtlPresetSecondsAt(index: number): number {
  const clamped = Math.max(
    0,
    Math.min(FILE_TTL_PRESETS_SECONDS.length - 1, Math.trunc(index)),
  );
  return FILE_TTL_PRESETS_SECONDS[clamped]!;
}

/** 发送页当前有效期展示（预设用简短中文，其它回落到完整格式） */
export function formatFileTtlQuickLabel(totalSeconds: number): string {
  const exactIndex = FILE_TTL_PRESETS_SECONDS.findIndex(
    (seconds) => seconds === totalSeconds,
  );
  if (exactIndex >= 0) {
    const seconds = FILE_TTL_PRESETS_SECONDS[exactIndex]!;
    if (seconds < 3600) {
      return `${seconds / 60}分钟`;
    }
    return `${seconds / 3600}小时`;
  }
  return formatDurationLabel(totalSeconds);
}

export function clampDurationParts(
  hours: number,
  minutes: number,
  seconds: number,
): DurationParts {
  let h = Number.isFinite(hours) ? Math.trunc(hours) : 0;
  let m = Number.isFinite(minutes) ? Math.trunc(minutes) : 0;
  let s = Number.isFinite(seconds) ? Math.trunc(seconds) : 0;

  h = Math.max(0, Math.min(24, h));
  m = Math.max(0, Math.min(59, m));
  s = Math.max(0, Math.min(59, s));

  let totalSeconds = h * 3600 + m * 60 + s;
  if (totalSeconds > MAX_FILE_TTL_SECONDS) {
    return {
      hours: 24,
      minutes: 0,
      seconds: 0,
      totalSeconds: MAX_FILE_TTL_SECONDS,
    };
  }

  return { hours: h, minutes: m, seconds: s, totalSeconds };
}

export function durationPartsFromSeconds(totalSeconds: number): DurationParts {
  const safe = Number.isFinite(totalSeconds)
    ? Math.max(0, Math.min(MAX_FILE_TTL_SECONDS, Math.trunc(totalSeconds)))
    : DEFAULT_FILE_TTL_SECONDS;
  return clampDurationParts(
    Math.floor(safe / 3600),
    Math.floor((safe % 3600) / 60),
    safe % 60,
  );
}

export function formatDurationLabel(totalSeconds: number): string {
  const { hours, minutes, seconds } = durationPartsFromSeconds(totalSeconds);
  return `${hours}小时${minutes}分钟${seconds}秒`;
}
