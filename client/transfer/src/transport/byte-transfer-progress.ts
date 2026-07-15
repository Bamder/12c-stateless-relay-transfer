/**
 * Shared byte-progress types for in-flight upload/download windows.
 * Naming: "window*" = aggregate across concurrent lanes, not whole-file totals.
 */

export interface ByteTransferProgress {
  /** Bytes completed for this single request so far. */
  bytesTransferred: number;
  /** Expected total for this request when known. */
  bytesTotal: number | undefined;
}

export type ByteTransferProgressListener = (
  progress: ByteTransferProgress,
) => void;

export interface WindowByteProgressSnapshot {
  /** Sum of bytes transferred across in-flight lanes. */
  windowBytesTransferred: number;
  /** Sum of known totals across in-flight lanes (0 if none known yet). */
  windowBytesTotal: number;
}

/** Tracks concurrent PUT/GET lanes so UI can show (?MB / nMB) for the active window. */
export class InFlightByteWindowMeter {
  private readonly lanes = new Map<
    string,
    { transferred: number; total: number }
  >();

  begin(laneId: string, bytesTotal: number): void {
    this.lanes.set(laneId, {
      transferred: 0,
      total: Math.max(0, Math.trunc(bytesTotal)),
    });
  }

  /** Update expected total without resetting transferred (e.g. Content-Length arrived). */
  setTotal(laneId: string, bytesTotal: number): void {
    const lane = this.lanes.get(laneId);
    if (lane === undefined) {
      return;
    }
    const nextTotal = Math.max(0, Math.trunc(bytesTotal));
    lane.total = nextTotal;
    if (nextTotal > 0) {
      lane.transferred = Math.min(lane.transferred, nextTotal);
    }
  }

  setTransferred(laneId: string, bytesTransferred: number): void {
    const lane = this.lanes.get(laneId);
    if (lane === undefined) {
      return;
    }
    const next = Math.max(0, Math.trunc(bytesTransferred));
    const capped = lane.total > 0 ? Math.min(lane.total, next) : next;
    // Keep lane high-water so PUT/GET retries do not yank the UI backwards.
    lane.transferred = Math.max(lane.transferred, capped);
  }

  end(laneId: string): void {
    this.lanes.delete(laneId);
  }

  snapshot(): WindowByteProgressSnapshot {
    let windowBytesTransferred = 0;
    let windowBytesTotal = 0;
    for (const lane of this.lanes.values()) {
      windowBytesTransferred += lane.transferred;
      windowBytesTotal += lane.total;
    }
    return { windowBytesTransferred, windowBytesTotal };
  }
}

/** Throttle high-frequency XHR/stream progress callbacks. */
export function createThrottledProgressListener(
  listener: ByteTransferProgressListener | undefined,
  intervalMs = 100,
): ByteTransferProgressListener | undefined {
  if (listener === undefined) {
    return undefined;
  }

  let lastEmitMs = 0;
  let pending: ByteTransferProgress | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = (): void => {
    if (pending === undefined) {
      return;
    }
    const next = pending;
    pending = undefined;
    lastEmitMs = Date.now();
    listener(next);
  };

  return (progress) => {
    pending = progress;
    const now = Date.now();
    if (now - lastEmitMs >= intervalMs) {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      flush();
      return;
    }
    if (timer === undefined) {
      timer = setTimeout(() => {
        timer = undefined;
        flush();
      }, intervalMs - (now - lastEmitMs));
    }
  };
}
