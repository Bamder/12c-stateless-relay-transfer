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
    };
