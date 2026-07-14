export const RECEIVE_CREDENTIAL_PATTERN = /^[A-Za-z0-9-]{12}$/;

export type ReceiveUrlWarning = 'insecure' | 'loopback';

export interface ReceiveUrlResult {
  url: string;
  warnings: ReceiveUrlWarning[];
}

export type ReceiveIntentInvalidReason =
  | 'duplicate-parameter'
  | 'invalid-credential'
  | 'missing-credential'
  | 'unexpected-parameter'
  | 'unsupported-version';

export type ReceiveIntent =
  | { kind: 'none' }
  | {
      kind: 'valid';
      credential: string;
      autoDownload: boolean;
    }
  | {
      kind: 'invalid';
      reason: ReceiveIntentInvalidReason;
    };

/** Build a public receive URL without leaking the credential into the query. */
export function buildReceiveUrl(
  registryUrl: string,
  credential: string,
): ReceiveUrlResult {
  assertValidCredential(credential);

  let url: URL;
  try {
    url = new URL(registryUrl);
  } catch {
    throw new TypeError('registryUrl must be an absolute HTTP(S) URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError('registryUrl must use HTTP or HTTPS');
  }
  if (url.username || url.password) {
    throw new TypeError('registryUrl must not include a username or password');
  }

  // A Registry can be hosted under a path prefix. Keep that prefix and make
  // the resulting location point at its client root rather than a sibling URL.
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/`;
  url.search = '';
  url.hash = new URLSearchParams({ v: '1', receive: credential }).toString();

  const warnings: ReceiveUrlWarning[] = [];
  if (url.protocol === 'http:') {
    warnings.push('insecure');
  }
  if (isLoopbackHostname(url.hostname)) {
    warnings.push('loopback');
  }

  return { url: url.toString(), warnings };
}

/** Parse a receive intent from window.location.hash without causing effects. */
export function parseReceiveIntent(hash: string): ReceiveIntent {
  const fragment = hash.startsWith('#') ? hash.slice(1) : hash;
  if (fragment.length === 0) {
    return { kind: 'none' };
  }

  const params = new URLSearchParams(fragment);
  for (const key of params.keys()) {
    if (key !== 'v' && key !== 'receive') {
      return { kind: 'invalid', reason: 'unexpected-parameter' };
    }
  }

  const versions = params.getAll('v');
  const credentials = params.getAll('receive');
  if (versions.length > 1 || credentials.length > 1) {
    return { kind: 'invalid', reason: 'duplicate-parameter' };
  }
  if (credentials.length === 0) {
    return { kind: 'invalid', reason: 'missing-credential' };
  }

  const credential = credentials[0];
  if (!RECEIVE_CREDENTIAL_PATTERN.test(credential)) {
    return { kind: 'invalid', reason: 'invalid-credential' };
  }

  if (versions.length === 0) {
    return { kind: 'valid', credential, autoDownload: false };
  }
  if (versions[0] !== '1') {
    return { kind: 'invalid', reason: 'unsupported-version' };
  }

  return { kind: 'valid', credential, autoDownload: true };
}

function assertValidCredential(credential: string): void {
  if (!RECEIVE_CREDENTIAL_PATTERN.test(credential)) {
    throw new TypeError('credential must contain exactly 12 letters, digits, or hyphens');
  }
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  return (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized === '::1' ||
    normalized.startsWith('::ffff:127.') ||
    /^::ffff:7f[0-9a-f]{2}(?::|$)/.test(normalized) ||
    /^127(?:\.\d{1,3}){3}$/.test(normalized)
  );
}
