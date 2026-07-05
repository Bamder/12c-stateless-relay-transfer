/** 注册服务器返回的单 token 中继 placement */
export interface RelayTargetRecord {
  role: 'primary' | 'replica';
  relayId: string;
  relayBaseUrl: string;
}

export interface RelayRegistryRecord {
  targets: RelayTargetRecord[];
  headers?: Record<string, string>;
}

export type RelayRegistryMap = Map<string, RelayRegistryRecord>;

export function primaryTarget(record: RelayRegistryRecord): RelayTargetRecord {
  const primary = record.targets.find((target) => target.role === 'primary');
  if (primary === undefined) {
    throw new Error('registry record missing primary target');
  }
  return primary;
}

/** 下载 resolve 返回空 targets 时表示 token 未登记或已失效 */
export function isResolvableRegistryRecord(record: RelayRegistryRecord): boolean {
  const primary = record.targets.find((target) => target.role === 'primary');
  return primary !== undefined && primary.relayBaseUrl.length > 0;
}

export interface BlockHashEntry {
  token: string;
  blockHash: string;
}

export interface OccupiedTokenInfo {
  token: string;
  expiryAt: string;
  blockHash: string | null;
}

export interface ReplicaPlacementFailure {
  token: string;
  relayId: string;
}

export interface ReserveUploadBlocksOptions {
  ttlSeconds?: number;
}

/**
 * 向注册服务器查询 token 当前绑定的中继地址（下载）。
 * 上传路由见 reserveUploadBlocks。
 */
export interface RegistryClient {
  lookupRelays(tokens: readonly string[]): Promise<RelayRegistryMap>;

  /** 上传前锁定 token 并登记 blockHash（原子一步） */
  reserveUploadBlocks(
    entries: readonly BlockHashEntry[],
    options?: ReserveUploadBlocksOptions,
  ): Promise<RelayRegistryMap>;

  /** replica 补传放弃时，通知 Registry 删除对应 replica placement */
  abandonReplicaPlacements(
    failures: readonly ReplicaPlacementFailure[],
  ): Promise<void>;
}

export interface HttpRegistryClientOptions {
  /** 注册服务器根 URL，例如 `https://registry.example.com` */
  registryBaseUrl: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
  /**
   * 下载批量查询 URL。默认 `POST {base}/api/relay/resolve`。
   * 请求体 `{ "tokens": ["..."] }`。
   */
  resolveUrl?: (registryBaseUrl: string) => string;
  /** 序列化 resolve 请求体，默认 `{ tokens }` */
  buildResolveRequestBody?: (tokens: readonly string[]) => unknown;
  /** 解析响应为 token → record 映射 */
  parseResponse?: (body: unknown, tokens: readonly string[]) => RelayRegistryMap;
}

const defaultResolveUrl = (registryBaseUrl: string): string => {
  const base = registryBaseUrl.replace(/\/$/, '');
  return `${base}/api/relay/resolve`;
};

const defaultBuildResolveRequestBody = (tokens: readonly string[]): unknown => ({
  tokens: [...tokens],
});

function normalizeTarget(value: unknown, token: string): RelayTargetRecord {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`registry target for ${token} is not an object`);
  }
  const record = value as Record<string, unknown>;
  const role = record.role;
  const relayId = record.relayId;
  const relayBaseUrl = record.relayBaseUrl;
  if (role !== 'primary' && role !== 'replica') {
    throw new Error(`registry target for ${token} has invalid role`);
  }
  if (typeof relayId !== 'string' || typeof relayBaseUrl !== 'string') {
    throw new Error(`registry target for ${token} missing relayId or relayBaseUrl`);
  }
  return {
    role,
    relayId,
    relayBaseUrl: relayBaseUrl.replace(/\/$/, ''),
  };
}

function normalizeRecord(value: unknown, token: string): RelayRegistryRecord {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`registry entry for ${token} is not an object`);
  }

  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.targets)) {
    throw new Error(`registry entry for ${token} missing targets array`);
  }

  if (record.targets.length === 0) {
    return {
      targets: [],
      headers:
        typeof record.headers === 'object' && record.headers !== null
          ? (record.headers as Record<string, string>)
          : undefined,
    };
  }

  const targets = record.targets.map((target) => normalizeTarget(target, token));
  if (!targets.some((target) => target.role === 'primary')) {
    throw new Error(`registry entry for ${token} missing primary target`);
  }

  return {
    targets,
    headers:
      typeof record.headers === 'object' && record.headers !== null
        ? (record.headers as Record<string, string>)
        : undefined,
  };
}

function defaultParseResponse(
  body: unknown,
  tokens: readonly string[],
): RelayRegistryMap {
  if (typeof body !== 'object' || body === null) {
    throw new Error('registry batch response is not an object');
  }

  const root = body as Record<string, unknown>;
  const routes = root.routes;
  const map = new Map<string, RelayRegistryRecord>();

  if (!Array.isArray(routes)) {
    throw new Error('registry batch response missing routes array');
  }

  for (const item of routes) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }
    const entry = item as Record<string, unknown>;
    const token = entry.token;
    if (typeof token !== 'string') {
      continue;
    }
    map.set(token, normalizeRecord(entry, token));
  }

  for (const token of tokens) {
    if (!map.has(token)) {
      map.set(token, { targets: [] });
    }
  }

  return map;
}

/** 单 token 下载查询（内部仍走批量 API） */
export async function lookupRelay(
  client: RegistryClient,
  token: string,
): Promise<RelayRegistryRecord> {
  const map = await client.lookupRelays([token]);
  const record = map.get(token);
  if (record === undefined || !isResolvableRegistryRecord(record)) {
    throw new Error(`registry missing token ${token}`);
  }
  return record;
}

/** 基于 HTTP 的注册服务器客户端 */
export class HttpRegistryClient implements RegistryClient {
  private readonly fetchFn: typeof fetch;
  private readonly resolveUrl: (registryBaseUrl: string) => string;
  private readonly buildResolveRequestBody: (tokens: readonly string[]) => unknown;
  private readonly parseResponse: (
    body: unknown,
    tokens: readonly string[],
  ) => RelayRegistryMap;

  constructor(private readonly options: HttpRegistryClientOptions) {
    this.fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.resolveUrl = options.resolveUrl ?? defaultResolveUrl;
    this.buildResolveRequestBody =
      options.buildResolveRequestBody ?? defaultBuildResolveRequestBody;
    this.parseResponse = options.parseResponse ?? defaultParseResponse;
  }

  async lookupRelays(tokens: readonly string[]): Promise<RelayRegistryMap> {
    const unique = [...new Set(tokens)];
    if (unique.length === 0) {
      return new Map();
    }

    const url = this.resolveUrl(this.options.registryBaseUrl);
    const response = await this.fetchFn(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.options.headers,
      },
      body: JSON.stringify(this.buildResolveRequestBody(unique)),
    });

    if (!response.ok) {
      let detail = '';
      try {
        const body: unknown = await response.json();
        if (
          typeof body === 'object' &&
          body !== null &&
          typeof (body as Record<string, unknown>).detail === 'string'
        ) {
          detail = `: ${(body as Record<string, string>).detail}`;
        }
      } catch {
        /* ignore non-JSON error bodies */
      }
      throw new Error(
        `registry batch lookup failed: HTTP ${response.status}${detail}`,
      );
    }

    const body: unknown = await response.json();
    return this.parseResponse(body, unique);
  }

  async reserveUploadBlocks(
    entries: readonly BlockHashEntry[],
    options: ReserveUploadBlocksOptions = {},
  ): Promise<RelayRegistryMap> {
    if (entries.length === 0) {
      return new Map();
    }

    const unique = new Map<string, string>();
    for (const entry of entries) {
      unique.set(entry.token, entry.blockHash);
    }

    const payload: Record<string, unknown> = {
      blocks: [...unique.entries()].map(([token, blockHash]) => ({
        token,
        blockHash,
      })),
    };
    if (options.ttlSeconds !== undefined) {
      payload.ttlSeconds = options.ttlSeconds;
    }

    const base = this.options.registryBaseUrl.replace(/\/$/, '');
    const response = await this.fetchFn(`${base}/api/relay/reserve-tokens`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.options.headers,
      },
      body: JSON.stringify(payload),
    });

    if (response.status === 409) {
      const body: unknown = await response.json();
      throw new RegistryTokenOccupiedError(parseOccupiedTokens(body));
    }

    if (!response.ok) {
      throw new Error(
        `registry reserve-tokens failed: HTTP ${response.status}`,
      );
    }

    const body: unknown = await response.json();
    return this.parseResponse(body, [...unique.keys()]);
  }

  async abandonReplicaPlacements(
    failures: readonly ReplicaPlacementFailure[],
  ): Promise<void> {
    if (failures.length === 0) {
      return;
    }

    const base = this.options.registryBaseUrl.replace(/\/$/, '');
    const response = await this.fetchFn(`${base}/api/relay/abandon-replica-placements`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.options.headers,
      },
      body: JSON.stringify({
        failures: failures.map((item) => ({
          token: item.token,
          relayId: item.relayId,
        })),
      }),
    });

    if (!response.ok) {
      throw new Error(
        `registry abandon-replica-placements failed: HTTP ${response.status}`,
      );
    }
  }
}

export class RegistryTokenOccupiedError extends Error {
  constructor(readonly occupiedTokens: OccupiedTokenInfo[]) {
    super(
      `registry tokens occupied: ${occupiedTokens.map((item) => item.token).join(', ')}`,
    );
    this.name = 'RegistryTokenOccupiedError';
  }
}

function parseOccupiedTokens(body: unknown): OccupiedTokenInfo[] {
  if (typeof body !== 'object' || body === null) {
    return [];
  }
  const occupied = (body as Record<string, unknown>).occupiedTokens;
  if (!Array.isArray(occupied)) {
    return [];
  }
  const result: OccupiedTokenInfo[] = [];
  for (const item of occupied) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }
    const record = item as Record<string, unknown>;
    if (typeof record.token !== 'string' || typeof record.expiryAt !== 'string') {
      continue;
    }
    result.push({
      token: record.token,
      expiryAt: record.expiryAt,
      blockHash:
        typeof record.blockHash === 'string' ? record.blockHash : null,
    });
  }
  return result;
}

interface CoalescingWaiter {
  tokens: string[];
  resolve: (map: RelayRegistryMap) => void;
  reject: (error: unknown) => void;
}

/**
 * 将同一事件循环内并发的 lookupRelays 合并为一次底层批量请求。
 */
export class CoalescingRegistryClient implements RegistryClient {
  private readonly waiters: CoalescingWaiter[] = [];
  private flushScheduled = false;

  constructor(private readonly inner: RegistryClient) {}

  lookupRelays(tokens: readonly string[]): Promise<RelayRegistryMap> {
    const unique = [...new Set(tokens)];
    if (unique.length === 0) {
      return Promise.resolve(new Map());
    }

    return new Promise<RelayRegistryMap>((resolve, reject) => {
      this.waiters.push({ tokens: unique, resolve, reject });
      this.scheduleFlush();
    });
  }

  private scheduleFlush(): void {
    if (this.flushScheduled) {
      return;
    }
    this.flushScheduled = true;
    queueMicrotask(() => {
      void this.flush();
    });
  }

  private async flush(): Promise<void> {
    this.flushScheduled = false;
    const waiters = this.waiters.splice(0);

    if (waiters.length === 0) {
      return;
    }

    const batch = new Set<string>();
    for (const waiter of waiters) {
      for (const token of waiter.tokens) {
        batch.add(token);
      }
    }

    try {
      const results = await this.inner.lookupRelays([...batch]);
      for (const waiter of waiters) {
        const slice: RelayRegistryMap = new Map();
        for (const token of waiter.tokens) {
          const record = results.get(token);
          if (record === undefined) {
            throw new Error(`registry missing token ${token}`);
          }
          slice.set(token, record);
        }
        waiter.resolve(slice);
      }
    } catch (error) {
      for (const waiter of waiters) {
        waiter.reject(error);
      }
    }
  }

  reserveUploadBlocks(
    entries: readonly BlockHashEntry[],
    options?: ReserveUploadBlocksOptions,
  ): Promise<RelayRegistryMap> {
    return this.inner.reserveUploadBlocks(entries, options);
  }

  abandonReplicaPlacements(
    failures: readonly ReplicaPlacementFailure[],
  ): Promise<void> {
    return this.inner.abandonReplicaPlacements(failures);
  }
}
