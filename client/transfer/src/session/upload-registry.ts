import type { UploadMap } from '../types.js';
import type { BlockHashEntry } from '../protocol/block-hash.js';
import { computeBlockHashSha256 } from '../protocol/block-hash.js';
import type { RegistryClient, UploadReservationMeta } from '../router/registry-client.js';
import {
  endpointsFromRegistryMap,
  replicaTargetsFromRegistryMap,
  type ReplicaUploadTarget,
} from '../router/endpoints-from-registry.js';
import type { RelayEndpointMap, RelayRouter } from '../router/relay-router.js';
import type { UploadStatusUpdate } from './upload-status.js';
export type { ReplicaUploadTarget, UploadReservationMeta };

export interface UploadRoutePlan {
  primary: RelayEndpointMap;
  replicas: Map<string, ReplicaUploadTarget[]>;
  reservation?: UploadReservationMeta;
}

export interface ResolveUploadEndpointsOptions {
  registry?: RegistryClient;
  ttlSeconds?: number;
  onStatus?: (status: UploadStatusUpdate) => void;
}

export async function resolveUploadEndpoints(
  uploads: UploadMap,
  router: RelayRouter,
  options: ResolveUploadEndpointsOptions = {},
): Promise<UploadRoutePlan> {
  if (options.registry !== undefined) {
    return reserveAndRegisterUploadBlocks(uploads, options.registry, {
      ttlSeconds: options.ttlSeconds,
      onStatus: options.onStatus,
    });
  }

  const tokens = [...uploads.keys()];
  if (tokens.length === 0) {
    return { primary: new Map(), replicas: new Map() };
  }

  options.onStatus?.({ phase: 'reserving' });
  return {
    primary: await router.resolveMany(tokens),
    replicas: new Map(),
  };
}

export async function reserveAndRegisterUploadBlocks(
  uploads: UploadMap,
  registry: RegistryClient,
  options: { ttlSeconds?: number; onStatus?: (status: UploadStatusUpdate) => void } = {},
): Promise<UploadRoutePlan> {
  const entries: BlockHashEntry[] = [];
  const total = uploads.size;
  let index = 0;
  for (const [token, blob] of uploads) {
    index++;
    options.onStatus?.({ phase: 'hashing', index, total });
    entries.push({
      token,
      blockHash: await computeBlockHashSha256(blob),
    });
  }

  options.onStatus?.({ phase: 'reserving' });
  const reserveResult = await registry.reserveUploadBlocks(entries, {
    ttlSeconds: options.ttlSeconds,
  });
  return {
    primary: endpointsFromRegistryMap(reserveResult.routes),
    replicas: replicaTargetsFromRegistryMap(reserveResult.routes),
    reservation: {
      grantedTtlSeconds: reserveResult.grantedTtlSeconds,
      requestedTtlSeconds: reserveResult.requestedTtlSeconds,
      degraded: reserveResult.degraded,
      placementPlan: reserveResult.placementPlan,
    },
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
