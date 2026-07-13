export interface RegistryConfig {
  /**
   * 注册服务器根 URL，例如 `http://203.0.113.10:8080`。
   * 与 `host` / `port` / `scheme` 二选一。
   */
  url?: string;
  host?: string;
  port?: number | string;
  scheme?: string;
  headers?: Record<string, string>;
  /** 合并同一事件循环内的并发 lookup（默认 true） */
  coalesce?: boolean;
}

/** Relay 集群能力（由 Registry 动态下发的 relay.config.json）。 */
export interface RelayFleetConfig {
  /** 单块 PUT body 上限（字节）；默认 32 MiB。 */
  maxBodyBytes?: number;
}

export interface TransferConfig {
  registry: RegistryConfig;
  relay?: RelayFleetConfig;
}

export const DEFAULT_CONFIG_FILENAME = 'relay.config.json';

export function resolveRegistryBaseUrl(registry: RegistryConfig): string {
  const envUrl = readEnv('STATELESS_RELAY_REGISTRY_URL');
  if (envUrl !== undefined && envUrl.length > 0) {
    return normalizeBaseUrl(envUrl);
  }

  if (typeof registry.url === 'string' && registry.url.length > 0) {
    return normalizeBaseUrl(registry.url);
  }

  if (typeof registry.host === 'string' && registry.host.length > 0) {
    const scheme =
      typeof registry.scheme === 'string' && registry.scheme.length > 0
        ? registry.scheme
        : 'http';
    const portSuffix = formatPort(registry.port);
    return normalizeBaseUrl(`${scheme}://${registry.host}${portSuffix}`);
  }

  throw new Error(
    'registry config requires "url" or "host" (optional "port", "scheme")',
  );
}

export function parseTransferConfig(value: unknown): TransferConfig {
  if (typeof value !== 'object' || value === null) {
    throw new Error('transfer config root must be an object');
  }

  const root = value as Record<string, unknown>;
  if (typeof root.registry !== 'object' || root.registry === null) {
    throw new Error('transfer config missing "registry" object');
  }

  const registry = root.registry as Record<string, unknown>;
  const config: RegistryConfig = {};

  if (registry.url !== undefined) {
    if (typeof registry.url !== 'string' || registry.url.length === 0) {
      throw new Error('registry.url must be a non-empty string');
    }
    config.url = registry.url;
  }

  if (registry.host !== undefined) {
    if (typeof registry.host !== 'string' || registry.host.length === 0) {
      throw new Error('registry.host must be a non-empty string');
    }
    config.host = registry.host;
  }

  if (registry.port !== undefined) {
    if (
      typeof registry.port !== 'number' &&
      typeof registry.port !== 'string'
    ) {
      throw new Error('registry.port must be a number or string');
    }
    config.port = registry.port;
  }

  if (registry.scheme !== undefined) {
    if (typeof registry.scheme !== 'string' || registry.scheme.length === 0) {
      throw new Error('registry.scheme must be a non-empty string');
    }
    config.scheme = registry.scheme;
  }

  if (registry.headers !== undefined) {
    config.headers = parseHeaders(registry.headers);
  }

  if (registry.coalesce !== undefined) {
    if (typeof registry.coalesce !== 'boolean') {
      throw new Error('registry.coalesce must be a boolean');
    }
    config.coalesce = registry.coalesce;
  }

  if (
    config.url === undefined &&
    config.host === undefined &&
    readEnv('STATELESS_RELAY_REGISTRY_URL') === undefined
  ) {
    throw new Error(
      'registry config requires "url" or "host", or set STATELESS_RELAY_REGISTRY_URL',
    );
  }

  resolveRegistryBaseUrl(config);
  const relay = parseRelayFleetConfig(root.relay);
  return relay === undefined ? { registry: config } : { registry: config, relay };
}

function parseRelayFleetConfig(value: unknown): RelayFleetConfig | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('transfer config "relay" must be an object');
  }

  const relay = value as Record<string, unknown>;
  const fleet: RelayFleetConfig = {};

  if (relay.maxBodyBytes !== undefined) {
    if (
      typeof relay.maxBodyBytes !== 'number' ||
      !Number.isFinite(relay.maxBodyBytes) ||
      relay.maxBodyBytes <= 0
    ) {
      throw new Error('relay.maxBodyBytes must be a positive finite number');
    }
    fleet.maxBodyBytes = Math.trunc(relay.maxBodyBytes);
  }

  return Object.keys(fleet).length > 0 ? fleet : {};
}

function parseHeaders(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('registry.headers must be an object');
  }

  const headers: Record<string, string> = {};
  for (const [key, headerValue] of Object.entries(value)) {
    if (typeof headerValue !== 'string') {
      throw new Error(`registry.headers.${key} must be a string`);
    }
    headers[key] = headerValue;
  }
  return headers;
}

function formatPort(port: number | string | undefined): string {
  if (port === undefined || port === '') {
    return '';
  }
  return `:${port}`;
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/$/, '');
}

function readEnv(name: string): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string> } })
    .process?.env;
  return env?.[name];
}
