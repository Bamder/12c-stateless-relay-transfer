export type UploadStatusUpdate =
  | {
      phase: 'preparing';
      /** 已 feed 的明文字节数（流式加密时有值） */
      bytesFed?: number;
      totalBytes?: number;
      /** 当前 GCM 段序号（1-based） */
      segmentIndex?: number;
      segmentTotal?: number;
    }
  | { phase: 'hashing'; index: number; total: number }
  | { phase: 'reserving' }
  | {
      phase: 'uploading';
      completed: number;
      inFlight: number;
      total: number;
      /**
       * Whole primary-stripe PUT progress (monotonic).
       * = finished blocks + in-flight XHR bytes.
       */
      transferBytesTransferred?: number;
      /** Sum of all primary wire-block body sizes (stable for this upload). */
      transferBytesTotal?: number;
    };
