import type { UploadMap } from '../types.js';
import type { BlockHashEntry } from '../protocol/block-hash.js';
import { computeBlockHashSha256 } from '../protocol/block-hash.js';
import type { RegistryClient } from '../router/registry-client.js';
import {
  endpointsFromRegistryMap,
  replicaTargetsFromRegistryMap,
  type ReplicaUploadTarget,
} from '../router/endpoints-from-registry.js';
import type { RelayEndpointMap, RelayRouter } from '../router/relay-router.js';

export type { ReplicaUploadTarget };

export interface UploadRoutePlan {
  primary: RelayEndpointMap;
  replicas: Map<string, ReplicaUploadTarget[]>;
}

export interface ResolveUploadEndpointsOptions {
  registry?: RegistryClient;
  ttlSeconds?: number;
}

export async function resolveUploadEndpoints(
  uploads: UploadMap,
  router: RelayRouter,
  options: ResolveUploadEndpointsOptions = {},
): Promise<UploadRoutePlan> {
  if (options.registry !== undefined) {
    return reserveAndRegisterUploadBlocks(uploads, options.registry, {
      ttlSeconds: options.ttlSeconds,
    });
  }

  const tokens = [...uploads.keys()];
  if (tokens.length === 0) {
    return { primary: new Map(), replicas: new Map() };
  }

  return {
    primary: await router.resolveMany(tokens),
    replicas: new Map(),
  };
}

export async function reserveAndRegisterUploadBlocks(
  uploads: UploadMap,
  registry: RegistryClient,
  options: { ttlSeconds?: number } = {},
): Promise<UploadRoutePlan> {
  const entries: BlockHashEntry[] = [];
  for (const [token, blob] of uploads) {
    entries.push({
      token,
      blockHash: await computeBlockHashSha256(blob),
    });
  }

  const routes = await registry.reserveUploadBlocks(entries, {
    ttlSeconds: options.ttlSeconds,
  });
  return {
    primary: endpointsFromRegistryMap(routes),
    replicas: replicaTargetsFromRegistryMap(routes),
  };
}

export function collectReplicaJobs(
  uploads: UploadMap,
  routePlan: UploadRoutePlan,
): ReplicaReplicationJob[] {
  const jobs: ReplicaReplicationJob[] = [];
  for (const [token, blob] of uploads) {
    const targets = routePlan.replicas.get(token);
    if (targets === undefined || targets.length === 0) {
      continue;
    }
    for (const target of targets) {
      jobs.push({
        token,
        relayId: target.relayId,
        blob,
        endpoint: target.endpoint,
      });
    }
  }
  return jobs;
}

export interface ReplicaReplicationJob {
  token: string;
  relayId: string;
  blob: Uint8Array;
  endpoint: ReplicaUploadTarget['endpoint'];
}
