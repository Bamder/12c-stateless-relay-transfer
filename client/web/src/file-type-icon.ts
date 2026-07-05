export type FileIconKind =
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'document'
  | 'spreadsheet'
  | 'archive'
  | 'code'
  | 'executable'
  | 'generic';

const IMAGE_EXT = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico', 'heic', 'heif', 'avif',
]);
const VIDEO_EXT = new Set(['mp4', 'mkv', 'mov', 'avi', 'webm', 'wmv', 'm4v', 'flv']);
const AUDIO_EXT = new Set(['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma', 'opus']);
const DOCUMENT_EXT = new Set([
  'doc', 'docx', 'odt', 'rtf', 'txt', 'md', 'markdown', 'pages',
]);
const SPREADSHEET_EXT = new Set(['xls', 'xlsx', 'csv', 'ods', 'tsv']);
const ARCHIVE_EXT = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz']);
const CODE_EXT = new Set([
  'js', 'ts', 'jsx', 'tsx', 'py', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'go', 'rs',
  'rb', 'php', 'swift', 'kt', 'sql', 'json', 'yaml', 'yml', 'xml', 'html', 'css', 'wasm',
]);
const EXECUTABLE_EXT = new Set(['exe', 'msi', 'dmg', 'app', 'deb', 'rpm', 'apk', 'bat', 'cmd', 'ps1']);

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0 || dot === filename.length - 1) {
    return '';
  }
  return filename.slice(dot + 1).toLowerCase();
}

export function resolveFileIconKind(file: Pick<File, 'name' | 'type'>): FileIconKind {
  const ext = extensionOf(file.name);
  const mime = file.type.toLowerCase();

  if (mime.startsWith('image/') || IMAGE_EXT.has(ext)) {
    return 'image';
  }
  if (mime.startsWith('video/') || VIDEO_EXT.has(ext)) {
    return 'video';
  }
  if (mime.startsWith('audio/') || AUDIO_EXT.has(ext)) {
    return 'audio';
  }
  if (ext === 'pdf' || mime === 'application/pdf') {
    return 'pdf';
  }
  if (SPREADSHEET_EXT.has(ext) || mime.includes('spreadsheet') || mime === 'text/csv') {
    return 'spreadsheet';
  }
  if (ARCHIVE_EXT.has(ext) || mime.includes('zip') || mime.includes('compressed')) {
    return 'archive';
  }
  if (CODE_EXT.has(ext) || mime.includes('javascript') || mime.includes('json')) {
    return 'code';
  }
  if (EXECUTABLE_EXT.has(ext)) {
    return 'executable';
  }
  if (
    DOCUMENT_EXT.has(ext) ||
    mime.startsWith('text/') ||
    mime.includes('word') ||
    mime.includes('document')
  ) {
    return 'document';
  }
  return 'generic';
}

const STROKE = '#111111';
const SW = 1.35;

function svgWrap(body: string): string {
  return `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}</svg>`;
}

const ICONS: Record<FileIconKind, string> = {
  generic: svgWrap(`
    <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" fill="#e2e8f0" stroke="${STROKE}" stroke-width="${SW}" stroke-linejoin="round"/>
    <path d="M14 3v5h5" fill="#cbd5e1" stroke="${STROKE}" stroke-width="${SW}" stroke-linejoin="round"/>
  `),
  image: svgWrap(`
    <rect x="4" y="5" width="16" height="14" rx="1.5" fill="#bae6fd" stroke="${STROKE}" stroke-width="${SW}"/>
    <circle cx="9" cy="10" r="1.6" fill="#fef08a" stroke="${STROKE}" stroke-width="${SW * 0.85}"/>
    <path d="M6 17l4.5-4 3 2.5L15 12l3 5H6z" fill="#7dd3fc" stroke="${STROKE}" stroke-width="${SW}" stroke-linejoin="round"/>
  `),
  video: svgWrap(`
    <rect x="4" y="6" width="16" height="12" rx="1.5" fill="#c4b5fd" stroke="${STROKE}" stroke-width="${SW}"/>
    <path d="M11 10.5v3l4-1.5-4-1.5z" fill="#ede9fe" stroke="${STROKE}" stroke-width="${SW}" stroke-linejoin="round"/>
  `),
  audio: svgWrap(`
    <path d="M10 6v9.2a2.8 2.8 0 1 1-1.4-2.4V8.5l7-2.1v7.8a2.8 2.8 0 1 1-1.4-2.4V9.8" fill="none" stroke="${STROKE}" stroke-width="${SW}" stroke-linecap="round" stroke-linejoin="round"/>
    <ellipse cx="8.6" cy="16.8" rx="2.2" ry="2" fill="#f9a8d4" stroke="${STROKE}" stroke-width="${SW}"/>
    <ellipse cx="15.6" cy="14.8" rx="2.2" ry="2" fill="#f9a8d4" stroke="${STROKE}" stroke-width="${SW}"/>
  `),
  pdf: svgWrap(`
    <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" fill="#fecaca" stroke="${STROKE}" stroke-width="${SW}" stroke-linejoin="round"/>
    <path d="M14 3v5h5" fill="#fca5a5" stroke="${STROKE}" stroke-width="${SW}" stroke-linejoin="round"/>
    <text x="12" y="17" text-anchor="middle" font-size="5.5" font-weight="700" fill="#991b1b" stroke="${STROKE}" stroke-width="0.35" font-family="Segoe UI, sans-serif">PDF</text>
  `),
  document: svgWrap(`
    <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" fill="#fef3c7" stroke="${STROKE}" stroke-width="${SW}" stroke-linejoin="round"/>
    <path d="M14 3v5h5" fill="#fde68a" stroke="${STROKE}" stroke-width="${SW}" stroke-linejoin="round"/>
    <path d="M8.5 13h7M8.5 16h5.5" stroke="${STROKE}" stroke-width="${SW}" stroke-linecap="round"/>
  `),
  spreadsheet: svgWrap(`
    <path d="M6 4h12a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" fill="#bbf7d0" stroke="${STROKE}" stroke-width="${SW}" stroke-linejoin="round"/>
    <path d="M6 9h13M6 13h13M6 17h13M10 4v16M14 4v16" stroke="${STROKE}" stroke-width="${SW * 0.9}"/>
  `),
  archive: svgWrap(`
    <path d="M5 8h14v11a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8z" fill="#fde68a" stroke="${STROKE}" stroke-width="${SW}" stroke-linejoin="round"/>
    <path d="M5 8l2-3h10l2 3" fill="#fcd34d" stroke="${STROKE}" stroke-width="${SW}" stroke-linejoin="round"/>
    <path d="M9 12h6M9 15h6" stroke="${STROKE}" stroke-width="${SW}" stroke-linecap="round"/>
  `),
  code: svgWrap(`
    <path d="M6 4h12a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" fill="#ddd6fe" stroke="${STROKE}" stroke-width="${SW}" stroke-linejoin="round"/>
    <path d="M9.5 10.5 7.5 12.5l2 2M14.5 10.5l2 2-2 2" fill="none" stroke="${STROKE}" stroke-width="${SW}" stroke-linecap="round" stroke-linejoin="round"/>
  `),
  executable: svgWrap(`
    <rect x="5" y="5" width="14" height="14" rx="2" fill="#fdba74" stroke="${STROKE}" stroke-width="${SW}"/>
    <circle cx="12" cy="12" r="3.2" fill="#ffedd5" stroke="${STROKE}" stroke-width="${SW}"/>
    <path d="M12 9.8v4.4M9.8 12h4.4" stroke="${STROKE}" stroke-width="${SW}" stroke-linecap="round"/>
  `),
};

export function renderFileIcon(container: HTMLElement, kind: FileIconKind): void {
  container.innerHTML = ICONS[kind];
}

export function renderFileIconForFile(container: HTMLElement, file: Pick<File, 'name' | 'type'>): void {
  renderFileIcon(container, resolveFileIconKind(file));
}

export function renderFileIconForName(container: HTMLElement, filename: string): void {
  renderFileIcon(container, resolveFileIconKind({ name: filename, type: '' }));
}
