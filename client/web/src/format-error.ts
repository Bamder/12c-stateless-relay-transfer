import { UploadPutError, TokenPlacementExpiredError } from '@stateless-relay/transfer';

function isEmscriptenCppException(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'excPtr' in error &&
    typeof (error as { excPtr: unknown }).excPtr === 'number'
  );
}

function readMessage(error: unknown): string | undefined {
  if (error === null || error === undefined) {
    return undefined;
  }
  if (typeof error === 'object' && 'message' in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === 'string' && message.trim().length > 0) {
      return message;
    }
  }
  return undefined;
}

function enrichSmbDecryptMessage(message: string): string {
  if (
    !message.includes('SMB integrity check failed') &&
    !message.includes('GCM authentication failed')
  ) {
    return message;
  }
  return '解密失败：凭证不正确，或文件尚未传完。请整段粘贴发送页的凭证，待上传 100% 后再下载。';
}

function enrichUploadPutMessage(message: string): string {
  if (message.includes('HTTP 413') || /\b413\b/.test(message)) {
    return (
      '上传失败：Relay 拒收该块（HTTP 413，请求体过大）。' +
      '请将 Relay 的 maxBodyBytes 调至与 Registry 一致（建议 32 MiB），' +
      '并确认穿透/反代的请求体上限不低于该值，然后重启 Relay 后重试。'
    );
  }
  if (
    /Failed to fetch|NetworkError|Load failed/i.test(message) ||
    message.includes('网络')
  ) {
    return (
      '上传中断：网络连接失败（常见于 SakuraFrp 等穿透隧道不稳定、并发过高或单块过大）。' +
      '请保持页面在前台、改用有线网络后重试；若反复失败，可尝试较小文件或等待网络稳定后再传。'
    );
  }
  return message;
}

/** 将未知异常格式化为可展示字符串（含 Emscripten CppException）。 */
export function formatUnknownError(error: unknown): string {
  if (error instanceof TokenPlacementExpiredError) {
    return (
      '文件登记已过期（超过发送时设置的有效期）。' +
      '请让发送方重新上传，并在有效期内完成下载。'
    );
  }
  if (error instanceof UploadPutError) {
    return enrichUploadPutMessage(error.message || error.name || '未知错误');
  }
  if (error instanceof Error) {
    const message = error.message || error.name || '未知错误';
    return enrichSmbDecryptMessage(message);
  }
  if (isEmscriptenCppException(error)) {
    console.error('[wasm] Emscripten C++ exception:', error);
    return '加密模块内部错误（常见于内存不足 std::bad_alloc）。请尝试较小文件、关闭其他标签页，或硬刷新后重试。';
  }
  const message = readMessage(error);
  if (message !== undefined) {
    return enrichSmbDecryptMessage(message);
  }
  if (typeof error === 'string') {
    return enrichSmbDecryptMessage(error);
  }
  return '未知错误（请查看浏览器控制台）';
}
