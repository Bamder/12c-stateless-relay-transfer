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

/**
 * Upload primary PUT endpoint: always the role=primary target.
 * Replica PUT targets come from replicaTargetsFromRegistryMap, not fallbacks.
 */
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

  return endpointFromBase(primary.relayBaseUrl, token, mergedHeaders);
}

/**
 * Download GET endpoint: follow Registry target order (read steering).
 * First live target is preferred; remaining targets are failover fallbacks.
 * Registry orders by ascending storage_rate so a light replica can beat a busy primary.
 */
export function downloadEndpointFromRegistryRecord(
  token: string,
  record: RelayRegistryRecord,
  headers?: Record<string, string>,
): RelayEndpoint {
  const mergedHeaders = { ...record.headers, ...headers };
  if (record.targets.length === 0) {
    throw new Error(`registry record for ${token} has no download targets`);
  }

  const [preferred, ...rest] = record.targets;
  return {
    ...endpointFromBase(preferred.relayBaseUrl, token, mergedHeaders),
    fallbacks: rest.map((target) =>
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
