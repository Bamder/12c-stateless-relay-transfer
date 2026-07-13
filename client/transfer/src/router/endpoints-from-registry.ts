import type { RelayEndpoint } from '../types.js';
import type {
  RelayRegistryMap,
  RelayRegistryRecord,
  RelayTargetRecord,
} from './registry-client.js';

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

export interface ReplicaUploadTarget {
  relayId: string;
  endpoint: RelayEndpoint;
}

export function endpointFromRegistryRecord(
  token: string,
  record: RelayRegistryRecord,
  headers?: Record<string, string>,
): RelayEndpoint {
  const mergedHeaders = { ...record.headers, ...headers };
  const primary = record.targets.find((target) => target.role === 'primary');
  if (primary === undefined) {
    throw new Error(`registry record for ${token} missing primary target`);
  }

  const replicas = record.targets.filter(
    (target): target is RelayTargetRecord => target.role === 'replica',
  );

  return {
    ...endpointFromBase(primary.relayBaseUrl, token, mergedHeaders),
    // 下载 failover 用；上传走 routePlan.replicas，条带 primary 仅 PUT 主目标。
    fallbacks: replicas.map((target) =>
      endpointFromBase(target.relayBaseUrl, token, mergedHeaders),
    ),
  };
}

export function endpointsFromRegistryMap(
  routes: RelayRegistryMap,
): Map<string, RelayEndpoint> {
  const endpoints = new Map<string, RelayEndpoint>();
  for (const [token, record] of routes) {
    endpoints.set(token, endpointFromRegistryRecord(token, record));
  }
  return endpoints;
}

export function replicaTargetsFromRegistryMap(
  routes: RelayRegistryMap,
): Map<string, ReplicaUploadTarget[]> {
  const replicas = new Map<string, ReplicaUploadTarget[]>();
  for (const [token, record] of routes) {
    const replicaTargets = record.targets.filter(
      (target): target is RelayTargetRecord => target.role === 'replica',
    );
    if (replicaTargets.length === 0) {
      continue;
    }
    replicas.set(
      token,
      replicaTargets.map((target) => ({
        relayId: target.relayId,
        endpoint: endpointFromBase(target.relayBaseUrl, token, record.headers),
      })),
    );
  }
  return replicas;
}
