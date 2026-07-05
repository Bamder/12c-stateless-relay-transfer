import type { RegistryClient } from '../router/registry-client.js';
import { putWithRetry } from '../resilience/put-with-retry.js';
import type { FetchUploadClient } from '../transport/fetch-upload-client.js';
import type { ReplicaReplicationJob } from './upload-registry.js';

export interface ReplicaReplicationFailure {
  token: string;
  relayId: string;
}

export interface RunAsyncReplicaReplicationOptions {
  putMaxAttempts: number;
  putRetryDelayMs: number;
  concurrency: number;
}

export async function runAsyncReplicaReplication(
  jobs: readonly ReplicaReplicationJob[],
  uploadClient: FetchUploadClient,
  registry: RegistryClient,
  options: RunAsyncReplicaReplicationOptions,
): Promise<void> {
  if (jobs.length === 0) {
    return;
  }

  const failures: ReplicaReplicationFailure[] = [];
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < jobs.length) {
      const current = nextIndex++;
      const job = jobs[current]!;
      try {
        await putWithRetry(uploadClient, job.endpoint, job.blob, {
          maxAttempts: options.putMaxAttempts,
          baseDelayMs: options.putRetryDelayMs,
        });
      } catch {
        failures.push({ token: job.token, relayId: job.relayId });
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(options.concurrency, jobs.length) },
    () => worker(),
  );
  await Promise.all(workers);

  if (failures.length > 0) {
    await registry.abandonReplicaPlacements(failures);
  }
}
