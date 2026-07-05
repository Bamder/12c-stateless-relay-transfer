import type { SmbMetadata, UploadMap } from '../types.js';
import type { TwelveCClient } from './twelve-c-client.js';
import type {
  CreateTwelveCModule,
  TwelveCWasmModule,
  TwelveCWasmUploadEntry,
} from './pkg/twelve_c_cryptography.js';

function entriesToUploadMap(entries: TwelveCWasmUploadEntry[]): UploadMap {
  const uploads: UploadMap = new Map();
  for (const entry of entries) {
    uploads.set(
      entry.token,
      entry.data instanceof Uint8Array ? entry.data : new Uint8Array(entry.data),
    );
  }
  return uploads;
}

function uploadMapToEntries(uploads: UploadMap): TwelveCWasmUploadEntry[] {
  return [...uploads.entries()].map(([token, data]) => ({ token, data }));
}

/** 将 Emscripten 模块适配为 TwelveCClient */
export function createTwelveCClientFromModule(
  module: TwelveCWasmModule,
): TwelveCClient {
  return {
    prepareUpload(filePlaintext, credential, originalFileName = '') {
      const plaintext =
        filePlaintext instanceof Uint8Array
          ? filePlaintext.slice()
          : new Uint8Array(filePlaintext);
      return entriesToUploadMap(
        module.prepareUpload(plaintext, credential, originalFileName),
      );
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
        numTokens: metadata.numTokens,
        wireBlockSize: metadata.wireBlockSize,
        ciphertextLength: metadata.ciphertextLength,
        originalFileLength: metadata.originalFileLength,
        originalFileName:
          typeof metadata.originalFileName === 'string'
            ? metadata.originalFileName
            : '',
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
