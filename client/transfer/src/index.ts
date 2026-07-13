export {
  CREDENTIAL_LENGTH,
  DEFAULT_INITIAL_TOKENS,
  KEY_CODE_LENGTH,
  SEARCH_CODE_LENGTH,
  fromUploadMap,
  splitCredential,
  toUploadMap,
  type CredentialParts,
  type RelayEndpoint,
  type SmbMetadata,
  type UploadMap,
} from './types.js';

export {
  selectSegmentCodeForFileSize,
  validateSegmentCode,
  decodeSegmentPlaintextBytesV21,
  countGcmSegmentsForFileSize,
  isV2WholeFileSegmentCode,
  isV21SegmentCode,
  V2_SEGMENT_CODE_WHOLE_FILE,
  V21_SEGMENT_CODE_MIN,
  V21_SEGMENT_CODE_MAX,
  V21_DEFAULT_SEGMENT_CODE_LARGE_FILE,
  V21_WHOLE_FILE_THRESHOLD_BYTES,
} from './segment-policy.js';

export {
  choosePolicyWireBlockBytes,
  resolveEffectiveWireBlockBytes,
  resolveRelayMaxBodyBytes,
  isLikelyMobileBrowser,
  WIRE_BLOCK_BYTES_16_MIB,
  WIRE_BLOCK_BYTES_32_MIB,
  DEFAULT_RELAY_MAX_BODY_BYTES,
  LARGE_FILE_WIRE_BLOCK_THRESHOLD_BYTES,
} from './wire-block-policy.js';

export type { TwelveCClient } from './wasm/twelve-c-client.js';
export {
  createTwelveCClientAdapter,
  createTwelveCClientFromModule,
  loadTwelveC,
  type LoadTwelveCOptions,
  type TwelveCWasmModule,
} from './wasm/loader.js';

export type { RelayRouter } from './router/relay-router.js';
export {
  RegistryRelayRouter,
  StaticRelayRouter,
} from './router/relay-router.js';
export type {
  RegistryClient,
  RelayRegistryMap,
  RelayRegistryRecord,
  RelayTargetRecord,
  ReplicaPlacementFailure,
  HttpRegistryClientOptions,
  BlockHashEntry,
  OccupiedTokenInfo,
  ReserveUploadBlocksResult,
  UploadPlacementPlan,
  UploadReservationMeta,
} from './router/registry-client.js';
export {
  CoalescingRegistryClient,
  HttpRegistryClient,
  isResolvableRegistryRecord,
  lookupRelay,
  primaryTarget,
  parseReserveUploadResponse,
  RegistryTokenOccupiedError,
  TokenPlacementExpiredError,
  type RelayResolveStatus,
} from './router/registry-client.js';
export type { RelayEndpointMap } from './router/relay-router.js';

export type {
  RegistryConfig,
  RelayFleetConfig,
  TransferConfig,
} from './config/transfer-config.js';
export {
  DEFAULT_CONFIG_FILENAME,
  parseTransferConfig,
  resolveRegistryBaseUrl,
} from './config/transfer-config.js';
export type { LoadTransferConfigFromUrlOptions } from './config/load-config.js';
export { loadTransferConfigFromUrl } from './config/load-config.js';
export type {
  CreateFromConfigOptions,
  RelayStack,
} from './config/create-from-config.js';
export {
  createRegistryClientFromConfig,
  createRelayRouterFromConfig,
  createRelayStackFromConfig,
} from './config/create-from-config.js';

export type { ReceiveTransport } from './transport/receive-transport.js';
export {
  FetchReceiveTransport,
  FetchUploadClient,
  type FetchUploadClientOptions,
} from './transport/index.js';

export {
  computeReceiveDownloadPlan,
  deriveIndexTokens,
  type ReceiveDownloadPlan,
} from './protocol/receive-plan.js';
export { resolveReceivedFileName } from './protocol/received-file-name.js';

export {
  computeBlockHashSha256,
  type BlockHashEntry as BlockHashRegistration,
} from './protocol/block-hash.js';

export {
  downloadAdaptive,
  receiveFromUploadMap,
  DEFAULT_BROWSER_RECEIVE_MEMORY_BUDGET_BYTES,
  resolveBrowserReceivePrefetchCount,
  resolveReceivePrefetchCount,
  type DownloadAdaptiveResult,
  type DownloadSessionOptions,
  type DownloadStatusUpdate,
} from './session/download-session.js';

export {
  prepareUpload,
  prepareUploadStreaming,
  prepareUploadStreamingWithHashes,
  uploadFile,
  uploadPrepared,
  resolveUploadEndpoints,
  reserveAndRegisterUploadBlocks,
  runAsyncReplicaReplication,
  UploadPutError,
  DEFAULT_PUT_MAX_ATTEMPTS,
  DEFAULT_PUT_RETRY_DELAY_MS,
  DEFAULT_BROWSER_PRIMARY_PUT_CONCURRENCY,
  DEFAULT_BROWSER_H2_PRIMARY_PUT_CONCURRENCY,
  DEFAULT_REPLICA_PUT_MAX_ATTEMPTS,
  DEFAULT_REPLICA_PUT_RETRY_DELAY_MS,
  DEFAULT_REPLICA_ASYNC_CONCURRENCY,
  UPLOAD_REPLICATION_POLICY_STRIPE_BEFORE_REPLICA,
  DEFAULT_UPLOAD_REPLICATION_POLICY,
  type UploadReplicationPolicy,
  type UploadProgress,
  type UploadStatusUpdate,
  type UploadPreparedResult,
  type UploadFileResult,
  type PrepareUploadStreamingOptions,
  type PrepareUploadStreamingResult,
  type UploadRoutePlan,
  type UploadSessionOptions,
  type ReplicaUploadTarget,
  type ReplicaReplicationJob,
} from './session/upload-session.js';

export { DEFAULT_BLOCK_HASH_CONCURRENCY } from './protocol/block-hash-pool.js';
