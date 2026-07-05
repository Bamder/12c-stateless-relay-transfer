import {
  CoalescingRegistryClient,
  HttpRegistryClient,
  type RegistryClient,
} from '../router/registry-client.js';
import {
  RegistryRelayRouter,
  type RelayRouter,
} from '../router/relay-router.js';
import { FetchReceiveTransport } from '../transport/fetch-receive-transport.js';
import { FetchUploadClient } from '../transport/fetch-upload-client.js';
import {
  resolveRegistryBaseUrl,
  type TransferConfig,
} from './transfer-config.js';

export interface CreateFromConfigOptions {
  fetch?: typeof fetch;
}

export interface RelayStack {
  registry: RegistryClient;
  router: RelayRouter;
  receiveTransport: FetchReceiveTransport;
  uploadClient: FetchUploadClient;
}

export function createRegistryClientFromConfig(
  config: TransferConfig,
  options: CreateFromConfigOptions = {},
): RegistryClient {
  const client = new HttpRegistryClient({
    registryBaseUrl: resolveRegistryBaseUrl(config.registry),
    headers: config.registry.headers,
    fetch: options.fetch,
  });

  if (config.registry.coalesce ?? true) {
    return new CoalescingRegistryClient(client);
  }

  return client;
}

export function createRelayRouterFromConfig(
  config: TransferConfig,
  registry?: RegistryClient,
  options: CreateFromConfigOptions = {},
): RegistryRelayRouter {
  return new RegistryRelayRouter(
    registry ?? createRegistryClientFromConfig(config, options),
  );
}

export function createRelayStackFromConfig(
  config: TransferConfig,
  options: CreateFromConfigOptions = {},
): RelayStack {
  const registry = createRegistryClientFromConfig(config, options);
  const router = createRelayRouterFromConfig(config, registry, options);

  return {
    registry,
    router,
    receiveTransport: new FetchReceiveTransport(router, {
      fetch: options.fetch,
    }),
    uploadClient: new FetchUploadClient({ fetch: options.fetch }),
  };
}
