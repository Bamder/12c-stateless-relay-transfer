export const MAX_FILE_TTL_SECONDS = 24 * 60 * 60;
export const DEFAULT_FILE_TTL_SECONDS = 3600;

export interface DurationParts {
  hours: number;
  minutes: number;
  seconds: number;
  totalSeconds: number;
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
