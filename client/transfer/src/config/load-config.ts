import {
  parseTransferConfig,
  type TransferConfig,
} from './transfer-config.js';

export interface LoadTransferConfigFromUrlOptions {
  fetch?: typeof fetch;
}

/** 通过 HTTP(S) 拉取 JSON 配置（浏览器或远程配置） */
export async function loadTransferConfigFromUrl(
  configUrl: string,
  options: LoadTransferConfigFromUrlOptions = {},
): Promise<TransferConfig> {
  const fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
  const response = await fetchFn(configUrl);
  if (!response.ok) {
    throw new Error(
      `failed to load transfer config from ${configUrl}: HTTP ${response.status}`,
    );
  }
  return parseTransferConfig((await response.json()) as unknown);
}
