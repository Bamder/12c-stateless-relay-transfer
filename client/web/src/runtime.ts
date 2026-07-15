import {
  createRelayStackFromConfig,
  decodeSegmentPlaintextBytesV21,
  loadTransferConfigFromUrl,
  loadTwelveC,
  parseTransferConfig,
  resolveRegistryBaseUrl,
  resolveRelayMaxBodyBytes,
  resolveEffectiveWireBlockBytes,
  selectSegmentCodeForFileSize,
  V21_WHOLE_FILE_THRESHOLD_BYTES,
  DEFAULT_RELAY_MAX_BODY_BYTES,
  type LoadTwelveCOptions,
  type RelayStack,
  type TwelveCClient,
  type TransferConfig,
  type UploadMap,
} from '@stateless-relay/transfer';
import { DEFAULT_FILE_TTL_SECONDS } from './file-ttl.js';

declare const __BUNDLED_TRANSFER_CONFIG__: unknown;

const REGISTRY_URL_STORAGE_KEY = 'stateless-relay.registryUrl';
const FILE_TTL_SECONDS_STORAGE_KEY = 'stateless-relay.fileTtlSeconds';

function resolveClientAssetUrl(relativePath: string): string {
  return new URL(relativePath, document.baseURI).toString();
}

const WASM_JS_URL = resolveClientAssetUrl('wasm/twelve_c_cryptography.js');
const WASM_BINARY_URL = resolveClientAssetUrl('wasm/twelve_c_cryptography.wasm');

export interface ClientRuntime {
  twelveC: TwelveCClient;
  stack: RelayStack;
  registryUrl: string;
  relayMaxBodyBytes: number;
}

type CreateTwelveCModuleFactory = NonNullable<LoadTwelveCOptions['createModule']>;

let createTwelveCModulePromise: Promise<CreateTwelveCModuleFactory> | null = null;

function readGlobalCreateTwelveCModule(): CreateTwelveCModuleFactory | null {
  const factory = (globalThis as { createTwelveCModule?: unknown }).createTwelveCModule;
  return typeof factory === 'function'
    ? (factory as CreateTwelveCModuleFactory)
    : null;
}

async function loadCreateTwelveCModule(): Promise<CreateTwelveCModuleFactory> {
  const existing = readGlobalCreateTwelveCModule();
  if (existing) {
    return existing;
  }

  if (!createTwelveCModulePromise) {
    createTwelveCModulePromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = WASM_JS_URL;
      script.async = true;
      script.onload = () => {
        const factory = readGlobalCreateTwelveCModule();
        if (!factory) {
          reject(new Error(`global createTwelveCModule missing after loading ${WASM_JS_URL}`));
          return;
        }
        resolve(factory);
      };
      script.onerror = () => {
        reject(new Error(`failed to load ${WASM_JS_URL}`));
      };
      document.head.appendChild(script);
    });
  }

  return createTwelveCModulePromise;
}

export function readStoredRegistryUrl(): string | null {
  const value = localStorage.getItem(REGISTRY_URL_STORAGE_KEY);
  if (!value || !value.trim()) {
    return null;
  }
  return value.trim();
}

export function saveStoredRegistryUrl(url: string): void {
  localStorage.setItem(REGISTRY_URL_STORAGE_KEY, url.trim());
}

export function clearStoredRegistryUrl(): void {
  localStorage.removeItem(REGISTRY_URL_STORAGE_KEY);
}

export function readStoredFileTtlSeconds(): number | null {
  const raw = localStorage.getItem(FILE_TTL_SECONDS_STORAGE_KEY);
  if (raw === null || raw.trim() === '') {
    return null;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return null;
  }
  return Math.min(parsed, 24 * 60 * 60);
}

export function saveStoredFileTtlSeconds(seconds: number): void {
  localStorage.setItem(
    FILE_TTL_SECONDS_STORAGE_KEY,
    String(Math.max(1, Math.trunc(seconds))),
  );
}

export function clearStoredFileTtlSeconds(): void {
  localStorage.removeItem(FILE_TTL_SECONDS_STORAGE_KEY);
}

export function getEffectiveFileTtlSeconds(): number {
  return readStoredFileTtlSeconds() ?? DEFAULT_FILE_TTL_SECONDS;
}

export async function loadEffectiveConfig(): Promise<TransferConfig> {
  // Electron loads the production client over file://, where renderer fetch
  // cannot read the adjacent JSON. Vite injects the same public config at build time.
  const config = document.location.protocol === 'file:'
    ? parseTransferConfig(__BUNDLED_TRANSFER_CONFIG__)
    : await loadTransferConfigFromUrl(
        resolveClientAssetUrl('relay.config.json'),
      );
  const storedUrl = readStoredRegistryUrl();
  if (storedUrl) {
    config.registry.url = storedUrl;
  }
  return config;
}

export async function loadTwelveCClient(): Promise<TwelveCClient> {
  return loadTwelveC({
    createModule: await loadCreateTwelveCModule(),
    wasmUrl: WASM_BINARY_URL,
  });
}

export interface RoundtripCaseResult {
  size: number;
  ok: boolean;
  numTokens?: number;
  wireBlockSize?: number;
  error?: string;
}

/** 纯 WASM 加解密 roundtrip（不依赖 Registry / Relay）。 */
export async function runCryptoRoundtrip(
  sizes: readonly number[],
  credential = 'ABCDEF123456',
): Promise<RoundtripCaseResult[]> {
  const twelveC = await loadTwelveCClient();
  const results: RoundtripCaseResult[] = [];

  for (const size of sizes) {
    try {
      const plaintext = new Uint8Array(size);
      for (let i = 0; i < size; i++) {
        plaintext[i] = i & 0xff;
      }

      const segmentCode = selectSegmentCodeForFileSize(size);
      const maxWireBlockBytes = resolveEffectiveWireBlockBytes({
        fileSizeBytes: size,
        relayMaxBodyBytes: DEFAULT_RELAY_MAX_BODY_BYTES,
      });
      const uploads =
        size > V21_WHOLE_FILE_THRESHOLD_BYTES
          ? await prepareUploadStreamingRoundtrip(
              twelveC,
              plaintext,
              credential,
              segmentCode,
              maxWireBlockBytes,
            )
          : twelveC.prepareUpload(plaintext, credential, '', segmentCode, maxWireBlockBytes);
      const recovered = twelveC.receiveFromUploadMap(credential, uploads);

      if (recovered.length !== size) {
        throw new Error(`length ${recovered.length} != ${size}`);
      }
      for (let i = 0; i < size; i++) {
        if (recovered[i] !== plaintext[i]) {
          throw new Error(`byte mismatch at ${i}`);
        }
      }

      const searchCode = credential.slice(0, 6);
      const token0Key = twelveC.deriveUploadToken(searchCode, 0);
      const token0 = uploads.get(token0Key);
      if (!token0) {
        throw new Error(`token0 missing: ${token0Key}`);
      }
      const meta = twelveC.parseSmbEncrypted(credential, token0);
      results.push({
        size,
        ok: true,
        numTokens: meta.numTokens,
        wireBlockSize: meta.wireBlockSize,
      });
    } catch (error) {
      results.push({
        size,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

async function prepareUploadStreamingRoundtrip(
  twelveC: TwelveCClient,
  plaintext: Uint8Array,
  credential: string,
  segmentCode: number,
  maxWireBlockBytes: number,
): Promise<UploadMap> {
  const session = twelveC.createUploadPrepareSession(
    credential,
    'roundtrip.bin',
    plaintext.length,
    segmentCode,
    maxWireBlockBytes,
  );
  const segmentBytes = decodeSegmentPlaintextBytesV21(segmentCode);

  for (let offset = 0; offset < plaintext.length; offset += segmentBytes) {
    const end = Math.min(offset + segmentBytes, plaintext.length);
    session.feed(plaintext.subarray(offset, end));
  }

  const uploads: UploadMap = new Map();
  for (const block of session.takeReadyBlocks()) {
    uploads.set(block.token, new Uint8Array(block.data));
  }
  const token0 = session.finalize();
  uploads.set(token0.token, new Uint8Array(token0.data));
  return uploads;
}

export async function createClientRuntime(
  config: TransferConfig,
): Promise<ClientRuntime> {
  const twelveC = await loadTwelveCClient();
  const stack = createRelayStackFromConfig(config);
  return {
    twelveC,
    stack,
    registryUrl: resolveRegistryBaseUrl(config.registry),
    relayMaxBodyBytes: resolveRelayMaxBodyBytes(config),
  };
}

export async function bootstrapClientRuntime(): Promise<ClientRuntime> {
  const config = await loadEffectiveConfig();
  return createClientRuntime(config);
}
