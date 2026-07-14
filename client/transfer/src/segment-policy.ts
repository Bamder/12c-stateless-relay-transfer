/** V2 whole-file mode (single GCM). */
export const V2_SEGMENT_CODE_WHOLE_FILE = 0;

/** V2.1 valid segment_code range (inclusive). */
export const V21_SEGMENT_CODE_MIN = 1;
export const V21_SEGMENT_CODE_MAX = 5;

/** Default V2.1 code for large files: 128 MiB segments (2^7). */
export const V21_DEFAULT_SEGMENT_CODE_LARGE_FILE = 4;

/**
 * Above this size, prefer 64 MiB segments (code 3) in the browser to shorten
 * each synchronous WASM GCM encrypt and keep the UI spinner responsive.
 */
export const V21_BROWSER_SEGMENT_CODE_THRESHOLD_BYTES = 64 * 1024 * 1024;

/** V2.1 segment_code for 64 MiB plaintext segments. */
export const V21_SEGMENT_CODE_64_MIB = 3;

/**
 * Application policy: files at or below this size use V2 whole-file encryption.
 * Above this threshold, {@link selectSegmentCodeForFileSize} picks V2.1.
 */
export const V21_WHOLE_FILE_THRESHOLD_BYTES = 16 * 1024 * 1024;

/**
 * Choose SMB segment_code from file size. Policy lives in the application layer;
 * the cryptography layer only consumes the explicit code.
 * Streaming and buffered prepareUpload use the same code.
 */
export function selectSegmentCodeForFileSize(byteLength: number): number {
  if (!Number.isFinite(byteLength) || byteLength < 0) {
    throw new Error('byteLength must be a non-negative finite number');
  }
  if (byteLength <= V21_WHOLE_FILE_THRESHOLD_BYTES) {
    return V2_SEGMENT_CODE_WHOLE_FILE;
  }
  if (byteLength > V21_BROWSER_SEGMENT_CODE_THRESHOLD_BYTES) {
    return V21_SEGMENT_CODE_64_MIB;
  }
  return V21_DEFAULT_SEGMENT_CODE_LARGE_FILE;
}

export function isV2WholeFileSegmentCode(segmentCode: number): boolean {
  return segmentCode === V2_SEGMENT_CODE_WHOLE_FILE;
}

export function isV21SegmentCode(segmentCode: number): boolean {
  return (
    segmentCode >= V21_SEGMENT_CODE_MIN && segmentCode <= V21_SEGMENT_CODE_MAX
  );
}

export function validateSegmentCode(segmentCode: number): void {
  if (isV2WholeFileSegmentCode(segmentCode) || isV21SegmentCode(segmentCode)) {
    return;
  }
  throw new Error(`unsupported segment_code: ${segmentCode}`);
}

/**
 * Decode V2.1 segment_code to plaintext bytes per segment (2^(i+4) MiB).
 * Throws for V2 whole-file code 0.
 */
export function decodeSegmentPlaintextBytesV21(segmentCode: number): number {
  validateSegmentCode(segmentCode);
  if (isV2WholeFileSegmentCode(segmentCode)) {
    throw new Error('decodeSegmentPlaintextBytesV21 requires a V2.1 segment_code');
  }
  const index = segmentCode - 1;
  return (1 << (index + 4)) * 1024 * 1024;
}

/** GCM 明文段数量（V2 整包为 1）。 */
export function countGcmSegmentsForFileSize(
  byteLength: number,
  segmentCode: number,
): number {
  if (!Number.isFinite(byteLength) || byteLength < 0) {
    throw new Error('byteLength must be a non-negative finite number');
  }
  validateSegmentCode(segmentCode);
  if (byteLength === 0) {
    return 1;
  }
  if (isV2WholeFileSegmentCode(segmentCode)) {
    return 1;
  }
  const segmentBytes = decodeSegmentPlaintextBytesV21(segmentCode);
  return Math.ceil(byteLength / segmentBytes);
}
