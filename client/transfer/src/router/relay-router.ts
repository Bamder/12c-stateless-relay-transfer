import type { RelayEndpoint } from '../types.js';
import { lookupRelay, isResolvableRegistryRecord, TokenPlacementExpiredError, type RegistryClient } from './registry-client.js';
import { downloadEndpointFromRegistryRecord } from './endpoints-from-registry.js';

export type RelayEndpointMap = Map<string, RelayEndpoint>;

/**
 * 为 token 解析 relay 访问端点。
 * 下载走 resolveMany；上传走 registry.reserveUploadBlocks（见 resolveUploadEndpoints）。
 */
export interface RelayRouter {
  resolve(token: string): Promise<RelayEndpoint>;

  resolveMany(tokens: readonly string[]): Promise<RelayEndpointMap>;
}

function endpointFromBase(
  relayBaseUrl: string,
  token: string,
  headers?: Record<string, string>,
): RelayEndpoint {
  const base = relayBaseUrl.replace(/\/$/, '');
  return {
    url: `${base}/${encodeURIComponent(token)}`,
    headers,
  };
}

/** 固定单一 relay 基址：`{baseUrl}/{token}`（离线联调） */
export class StaticRelayRouter implements RelayRouter {
  constructor(
    private readonly baseUrl: string,
    private readonly headers?: Record<string, string>,
  ) {}

  async resolve(token: string): Promise<RelayEndpoint> {
    const map = await this.resolveMany([token]);
    const endpoint = map.get(token);
    if (endpoint === undefined) {
      throw new Error(`failed to resolve token: ${token}`);
    }
    return endpoint;
  }

  async resolveMany(tokens: readonly string[]): Promise<RelayEndpointMap> {
    const map: RelayEndpointMap = new Map();
    for (const token of new Set(tokens)) {
      map.set(token, endpointFromBase(this.baseUrl, token, this.headers));
    }
    return map;
  }
}

/** 生产下载路由：向注册服务器批量查询 token placement */
export class RegistryRelayRouter implements RelayRouter {
  constructor(
    private readonly registry: RegistryClient,
    private readonly defaultHeaders?: Record<string, string>,
  ) {}

  async resolve(token: string): Promise<RelayEndpoint> {
    const record = await lookupRelay(this.registry, token);
    return downloadEndpointFromRegistryRecord(token, record, this.defaultHeaders);
  }

  async resolveMany(tokens: readonly string[]): Promise<RelayEndpointMap> {
    const unique = [...new Set(tokens)];
    if (unique.length === 0) {
      return new Map();
    }

    const records = await this.registry.lookupRelays(unique);
    const endpoints: RelayEndpointMap = new Map();

    for (const token of unique) {
      const record = records.get(token);
      if (record?.resolveStatus === 'expired') {
        throw new TokenPlacementExpiredError(token);
      }
      if (record === undefined || !isResolvableRegistryRecord(record)) {
        continue;
      }
      endpoints.set(
        token,
        downloadEndpointFromRegistryRecord(token, record, this.defaultHeaders),
      );
    }

    return endpoints;
  }
}
