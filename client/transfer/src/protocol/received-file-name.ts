const INVALID_FILE_NAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;

/** 将 SMB 中的 originalFileName 规范化为浏览器可下载的安全文件名 */
export function resolveReceivedFileName(
  originalFileName: string,
  credential: string,
): string {
  const trimmed = originalFileName.trim();
  if (trimmed.length > 0) {
    const base = trimmed.replace(INVALID_FILE_NAME_CHARS, '_').replace(/[. ]+$/, '');
    if (base.length > 0 && base !== '.' && base !== '..') {
      return base;
    }
  }
  return `received-${credential}`;
}
