import type { UploadMap } from '../types.js';
import type { BlockHashEntry } from '../protocol/block-hash.js';
import {
  computeUploadBlockHashesParallel,
  DEFAULT_BLOCK_HASH_CONCURRENCY,
} from '../protocol/block-hash-pool.js';
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
  /** 流水线阶段已算好的块哈希；提供时跳过哈希 */
  precomputedBlockHashes?: BlockHashEntry[];
  /** 并行哈希并发上限，默认 12 */
  hashConcurrency?: number;
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
      precomputedBlockHashes: options.precomputedBlockHashes,
      hashConcurrency: options.hashConcurrency,
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
  options: {
    ttlSeconds?: number;
    onStatus?: (status: UploadStatusUpdate) => void;
    precomputedBlockHashes?: BlockHashEntry[];
    hashConcurrency?: number;
  } = {},
): Promise<UploadRoutePlan> {
  const entries =
    options.precomputedBlockHashes ??
    (await computeUploadBlockHashesParallel(uploads, {
      concurrency: options.hashConcurrency ?? DEFAULT_BLOCK_HASH_CONCURRENCY,
      onProgress: (completed, total) => {
        options.onStatus?.({ phase: 'hashing', index: completed, total });
      },
    }));

  if (entries.length !== uploads.size) {
    throw new Error(
      `block hash count mismatch: expected ${uploads.size}, got ${entries.length}`,
    );
  }

  const hashByToken = new Map(entries.map((entry) => [entry.token, entry.blockHash]));
  for (const token of uploads.keys()) {
    if (!hashByToken.has(token)) {
      throw new Error(`missing block hash for token: ${token}`);
    }
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
