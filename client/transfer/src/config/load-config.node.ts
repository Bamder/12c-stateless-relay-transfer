import { access, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_CONFIG_FILENAME,
  parseTransferConfig,
  type TransferConfig,
} from './transfer-config.js';

export interface LoadTransferConfigOptions {
  /** 配置文件路径；默认依次搜索 cwd 与包目录下的 relay.config.json */
  configPath?: string;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function packageConfigCandidates(): string[] {
  const modulePath = fileURLToPath(import.meta.url);
  const packageRoot = resolve(dirname(modulePath), '..', '..');
  return [join(packageRoot, DEFAULT_CONFIG_FILENAME)];
}

async function resolveConfigPath(explicitPath?: string): Promise<string> {
  if (explicitPath !== undefined) {
    return isAbsolute(explicitPath)
      ? explicitPath
      : resolve(process.cwd(), explicitPath);
  }

  const envPath = process.env.STATELESS_RELAY_CONFIG;
  if (envPath !== undefined && envPath.length > 0) {
    return isAbsolute(envPath) ? envPath : resolve(process.cwd(), envPath);
  }

  const candidates = [
    resolve(process.cwd(), DEFAULT_CONFIG_FILENAME),
    ...packageConfigCandidates(),
  ];

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `transfer config not found; create ${DEFAULT_CONFIG_FILENAME} in the working directory ` +
      `(see relay.config.example.json) or set STATELESS_RELAY_CONFIG`,
  );
}

export async function loadTransferConfigFromFile(
  configPath: string,
): Promise<TransferConfig> {
  const absolutePath = isAbsolute(configPath)
    ? configPath
    : resolve(process.cwd(), configPath);
  const text = await readFile(absolutePath, 'utf8');
  return parseTransferConfig(JSON.parse(text) as unknown);
}

/** 从本地 relay.config.json 加载配置（Node.js） */
export async function loadTransferConfig(
  options: LoadTransferConfigOptions = {},
): Promise<TransferConfig> {
  const configPath = await resolveConfigPath(options.configPath);
  return loadTransferConfigFromFile(configPath);
}
