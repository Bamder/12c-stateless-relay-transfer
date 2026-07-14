import qrcode from 'qrcode-generator';

export const QR_DOWNLOAD_FILENAME = '12c-receive-qr.svg';

/** Generate a self-contained, scalable SVG without contacting a third party. */
export function createQrSvg(url: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(url, 'Byte');
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
}

/** Copy share text, falling back for browsers without Clipboard API access. */
export async function copyShareText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Permission and secure-context failures can still use the legacy fallback.
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.readOnly = true;
  textarea.setAttribute('aria-hidden', 'true');
  textarea.style.position = 'fixed';
  textarea.style.inset = '0 auto auto -9999px';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);

  try {
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    if (!document.execCommand('copy')) {
      throw new Error('browser rejected the copy command');
    }
  } finally {
    textarea.remove();
  }
}

/** Download the SVG rendered inside a QR container using a credential-free name. */
export function downloadQrSvg(container: Element): void {
  const svg = container.matches('svg') ? container : container.querySelector('svg');
  if (!(svg instanceof SVGElement)) {
    throw new Error('QR container does not contain an SVG element');
  }

  const source = new XMLSerializer().serializeToString(svg);
  const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = QR_DOWNLOAD_FILENAME;
  anchor.hidden = true;
  document.body.appendChild(anchor);

  try {
    anchor.click();
  } finally {
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }
}
