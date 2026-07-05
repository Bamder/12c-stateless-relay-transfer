import type { OccupiedTokenInfo } from '@stateless-relay/transfer';

export class UploadTokenReservationExhaustedError extends Error {
  constructor(
    readonly attempts: number,
    readonly lastOccupiedTokens: readonly OccupiedTokenInfo[],
  ) {
    super(
      `upload token reservation failed after ${attempts} attempts; ` +
        `last occupied: ${lastOccupiedTokens.map((item) => item.token).join(', ')}`,
    );
    this.name = 'UploadTokenReservationExhaustedError';
  }
}
