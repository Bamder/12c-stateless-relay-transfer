import { runCryptoRoundtrip, type RoundtripCaseResult } from './runtime.js';

const ROUNDTRIP_SIZES = [1, 5 * 1024, 1024 * 1024, 17 * 1024 * 1024] as const;

declare global {
  interface Window {
    __ROUNDTRIP__?: RoundtripCaseResult[] | { error: string };
  }
}

function formatResult(result: RoundtripCaseResult): string {
  if (!result.ok) {
    return `${result.size}B FAIL (${result.error})`;
  }
  return `${result.size}B ok tokens=${result.numTokens} wire=${result.wireBlockSize}`;
}

export async function runRoundtripSelftest(): Promise<void> {
  const status = document.getElementById('boot-status');
  const progressBar = document.getElementById('boot-progress-bar');
  if (!status) {
    throw new Error('missing #boot-status');
  }

  status.textContent = '正在加载 WASM…';
  if (progressBar) {
    progressBar.style.width = '20%';
  }

  try {
    status.textContent = '正在跑 roundtrip (1B / 5KB / 1MB / 17MB)…';
    if (progressBar) {
      progressBar.style.width = '60%';
    }

    const results = await runCryptoRoundtrip(ROUNDTRIP_SIZES);
    window.__ROUNDTRIP__ = results;

    const failed = results.filter((item) => !item.ok);
    if (failed.length > 0) {
      status.textContent = `roundtrip 失败：${failed.map(formatResult).join('; ')}`;
      if (progressBar) {
        progressBar.style.width = '0%';
      }
      return;
    }

    status.textContent = `roundtrip 通过：${results.map(formatResult).join('; ')}`;
    if (progressBar) {
      progressBar.style.width = '100%';
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    window.__ROUNDTRIP__ = { error: message };
    status.textContent = `roundtrip 异常：${message}`;
    if (progressBar) {
      progressBar.style.width = '0%';
    }
  }
}
