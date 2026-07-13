/** 12 位传输凭证长度 */
export const CREDENTIAL_LENGTH = 12;

/** 搜索码长度（凭证前 6 位） */
export const SEARCH_CODE_LENGTH = 6;

/** 密钥码长度（凭证后 6 位） */
export const KEY_CODE_LENGTH = 6;

/** Π_Recv_Adaptive 初始并发预取 token 数（含 Token[0]） */
export const DEFAULT_INITIAL_TOKENS = 64;

/** token → 密文块（SMB + 数据分片） */
export type UploadMap = Map<string, Uint8Array>;

export interface CredentialParts {
  searchCode: string;
  keyCode: string;
}

export interface SmbMetadata {
  numTokens: number;
  wireBlockSize: number;
  ciphertextLength: number;
  originalFileLength: number;
  originalFileName: string;
  /** 0 = V2 whole-file; 1..5 = V2.1 segment code */
  segmentCode: number;
}

/** WASM uint64 等可能以 bigint 进入 JS；统一为 safe integer 再比较。 */
export function toSafeByteLength(value: unknown, label = 'byteLength'): number {
  if (typeof value === 'bigint') {
    if (value < 0n) {
      throw new Error(`${label} must be non-negative`);
    }
    const asNumber = Number(value);
    if (!Number.isSafeInteger(asNumber) || BigInt(asNumber) !== value) {
      throw new Error(`${label} exceeds JS safe integer range: ${value}`);
    }
    return asNumber;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(value)) {
      throw new Error(`${label} must be a non-negative safe integer: ${value}`);
    }
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    return toSafeByteLength(Number(value), label);
  }

  throw new Error(`${label} must be a byte length: ${String(value)}`);
}

export function byteLengthsEqual(left: unknown, right: unknown): boolean {
  return toSafeByteLength(left) === toSafeByteLength(right);
}

/** relay 上单个 token 的访问端点（由 RegistryClient / RelayRouter 决定） */
export interface RelayEndpoint {
  url: string;
  headers?: Record<string, string>;
  /** 下载 failover：primary 失败时依次尝试 */
  fallbacks?: ReadonlyArray<Pick<RelayEndpoint, 'url' | 'headers'>>;
}

export function splitCredential(credential: string): CredentialParts {
  if (credential.length !== CREDENTIAL_LENGTH) {
    throw new Error(`credential must be exactly ${CREDENTIAL_LENGTH} characters`);
  }

  return {
    searchCode: credential.slice(0, SEARCH_CODE_LENGTH),
    keyCode: credential.slice(SEARCH_CODE_LENGTH),
  };
}

export function toUploadMap(record: Record<string, Uint8Array>): UploadMap {
  return new Map(Object.entries(record));
}

export function fromUploadMap(uploads: UploadMap): Record<string, Uint8Array> {
  return Object.fromEntries(uploads.entries());
}
