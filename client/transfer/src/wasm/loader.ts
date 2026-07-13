import type { SmbMetadata, UploadMap } from '../types.js';
import { toSafeByteLength } from '../types.js';
import type { TwelveCClient } from './twelve-c-client.js';
import type {
  CreateTwelveCModule,
  TwelveCWasmModule,
  TwelveCWasmUploadEntry,
} from './pkg/twelve_c_cryptography.js';
import type { UploadPrepareSession, UploadWireBlock, ReceiveDecryptSession } from './twelve-c-client.js';

function entriesToUploadMap(entries: TwelveCWasmUploadEntry[]): UploadMap {
  const uploads: UploadMap = new Map();
  for (const entry of entries) {
    uploads.set(entry.token, new Uint8Array(entry.data));
  }
  return uploads;
}

function wasmEntryToWireBlock(entry: TwelveCWasmUploadEntry): UploadWireBlock {
  return {
    token: entry.token,
    data: new Uint8Array(entry.data),
  };
}

function uploadMapToEntries(uploads: UploadMap): TwelveCWasmUploadEntry[] {
  return [...uploads.entries()].map(([token, data]) => ({
    token,
    data: new Uint8Array(data),
  }));
}

/** 将 Emscripten 模块适配为 TwelveCClient */
export function createTwelveCClientFromModule(
  module: TwelveCWasmModule,
): TwelveCClient {
  return {
    prepareUpload(
      filePlaintext,
      credential,
      originalFileName = '',
      segmentCode = 0,
      maxWireBlockBytes,
    ) {
      const plaintext =
        filePlaintext instanceof Uint8Array
          ? filePlaintext
          : new Uint8Array(filePlaintext);
      return entriesToUploadMap(
        module.prepareUpload(
          plaintext,
          credential,
          originalFileName,
          segmentCode,
          maxWireBlockBytes,
        ),
      );
    },

    createUploadPrepareSession(
      credential,
      originalFileName = '',
      filePlaintextSize,
      segmentCode,
      maxWireBlockBytes,
    ) {
      const createSession = (
        module as TwelveCWasmModule & {
          createUploadPrepareSession?: (
            credential: string,
            originalFileName: string,
            filePlaintextSize: number,
            segmentCode: number,
            maxWireBlockBytes: number,
          ) => TwelveCWasmModule['UploadPrepareSession'];
        }
      ).createUploadPrepareSession;

      let session: TwelveCWasmModule['UploadPrepareSession'];
      if (typeof createSession === 'function') {
        session = createSession(
          credential,
          originalFileName,
          filePlaintextSize,
          segmentCode,
          maxWireBlockBytes,
        );
      } else {
        const SessionCtor = (
          module as TwelveCWasmModule & {
            UploadPrepareSession?: new (
              credential: string,
              originalFileName: string,
              filePlaintextSize: number,
              segmentCode: number,
              maxWireBlockBytes: number,
            ) => TwelveCWasmModule['UploadPrepareSession'];
          }
        ).UploadPrepareSession;
        if (typeof SessionCtor !== 'function') {
          throw new Error(
            'WASM 模块过旧，缺少 UploadPrepareSession。请运行 client/build.ps1 -ForceWasm 后刷新页面。',
          );
        }
        session = new SessionCtor(
          credential,
          originalFileName,
          filePlaintextSize,
          segmentCode,
          maxWireBlockBytes,
        );
      }
      return {
        feed(chunk: Uint8Array) {
          session.feed(chunk);
        },
        takeReadyBlocks(): UploadWireBlock[] {
          return session.takeReadyBlocks().map(wasmEntryToWireBlock);
        },
        finalize(): UploadWireBlock {
          return wasmEntryToWireBlock(session.finalize());
        },
      } satisfies UploadPrepareSession;
    },

    createReceiveDecryptSession(credential, token0Wire) {
      const createSession = (
        module as TwelveCWasmModule & {
          createReceiveDecryptSession?: (
            credential: string,
            token0Wire: Uint8Array,
          ) => TwelveCWasmModule['ReceiveDecryptSession'];
        }
      ).createReceiveDecryptSession;

      let session: TwelveCWasmModule['ReceiveDecryptSession'];
      if (typeof createSession === 'function') {
        session = createSession(credential, token0Wire);
      } else {
        const SessionCtor = (
          module as TwelveCWasmModule & {
            ReceiveDecryptSession?: new (
              credential: string,
              token0Wire: Uint8Array,
            ) => TwelveCWasmModule['ReceiveDecryptSession'];
          }
        ).ReceiveDecryptSession;
        if (typeof SessionCtor !== 'function') {
          throw new Error(
            'WASM 模块过旧，缺少 ReceiveDecryptSession。请运行 client/build.ps1 -ForceWasm 后刷新页面。',
          );
        }
        session = new SessionCtor(credential, token0Wire);
      }

      return {
        addWireToken(tokenIndex: number, wireData: Uint8Array) {
          session.addWireToken(tokenIndex, wireData);
        },
        finalize(): Uint8Array {
          const plaintext = session.finalize();
          return plaintext instanceof Uint8Array
            ? plaintext
            : new Uint8Array(plaintext);
        },
        completeFinalize() {
          session.completeFinalize();
        },
        paddedPlaintextLength(): number | undefined {
          if (typeof session.paddedPlaintextLength !== 'function') {
            return undefined;
          }
          return toSafeByteLength(
            session.paddedPlaintextLength(),
            'paddedPlaintextLength',
          );
        },
        originalFileLength(): number | undefined {
          if (typeof session.originalFileLength !== 'function') {
            return undefined;
          }
          return toSafeByteLength(
            session.originalFileLength(),
            'originalFileLength',
          );
        },
        takePlaintextChunk(maxBytes: number): Uint8Array {
          const chunk = session.takePlaintextChunk(maxBytes);
          const bytes =
            chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
          return bytes.slice();
        },
      } satisfies ReceiveDecryptSession;
    },

    receiveFromUploadMap(credential, uploads) {
      const plaintext = module.receiveFromUploadMap(
        credential,
        uploadMapToEntries(uploads),
      );
      return plaintext instanceof Uint8Array
        ? plaintext
        : new Uint8Array(plaintext);
    },

    deriveUploadToken(searchCode, index) {
      return module.deriveUploadToken(searchCode, index);
    },

    parseSmbEncrypted(credential, smbEncrypted) {
      const metadata = module.parseSmbEncrypted(credential, smbEncrypted);
      return {
        numTokens: toSafeByteLength(metadata.numTokens, 'numTokens'),
        wireBlockSize: toSafeByteLength(metadata.wireBlockSize, 'wireBlockSize'),
        ciphertextLength: toSafeByteLength(
          metadata.ciphertextLength,
          'ciphertextLength',
        ),
        originalFileLength: toSafeByteLength(
          metadata.originalFileLength,
          'originalFileLength',
        ),
        originalFileName:
          typeof metadata.originalFileName === 'string'
            ? metadata.originalFileName
            : '',
        segmentCode:
          typeof metadata.segmentCode === 'number' ? metadata.segmentCode : 0,
      } satisfies SmbMetadata;
    },
  };
}

export interface LoadTwelveCOptions {
  /** createTwelveCModule 工厂；默认动态加载 pkg 内产物 */
  createModule?: CreateTwelveCModule;
  /** .wasm 文件 URL（浏览器环境常用） */
  wasmUrl?: string;
}

export async function loadTwelveC(
  options: LoadTwelveCOptions = {},
): Promise<TwelveCClient> {
  const createModule =
    options.createModule ??
    (await import('./pkg/twelve_c_cryptography.js')).default;

  const module = await createModule({
    locateFile: (path) => {
      if (path.endsWith('.wasm') && options.wasmUrl) {
        return options.wasmUrl;
      }
      return path;
    },
  });

  return createTwelveCClientFromModule(module);
}

/** @deprecated 使用 createTwelveCClientFromModule */
export function createTwelveCClientAdapter(client: TwelveCClient): TwelveCClient {
  return client;
}

export type { TwelveCWasmModule } from './pkg/twelve_c_cryptography.js';
