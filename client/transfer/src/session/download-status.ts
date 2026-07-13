export type DownloadStatusUpdate =
  /** Π_Recv 启动：初始接收窗口 [0,m) 含 Token[0] 的 Registry 定位 */
  | {
      phase: 'resolving_initial';
      fromIndex: number;
      toIndex: number;
      total: number;
    }
  /** 接收窗口滑动：为后续块批量 resolve（得址后转入传输/下载） */
  | {
      phase: 'resolving_window';
      fromIndex: number;
      toIndex: number;
      total: number;
    }
  /** 含 SMB 元数据的线区块正在传输（与其它块并行，非单独优先） */
  | { phase: 'awaiting_metadata_block' }
  | {
      phase: 'waiting_metadata_block';
      reason: 'registry' | 'relay';
      attempt: number;
    }
  | { phase: 'parsing_metadata' }
  | { phase: 'downloading'; completed: number; total: number }
  | { phase: 'decrypting'; total: number };
