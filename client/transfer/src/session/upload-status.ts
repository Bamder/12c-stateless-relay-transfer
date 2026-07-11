export type UploadStatusUpdate =
  | { phase: 'preparing' }
  | { phase: 'hashing'; index: number; total: number }
  | { phase: 'reserving' }
  | {
      phase: 'uploading';
      completed: number;
      inFlight: number;
      total: number;
    };
