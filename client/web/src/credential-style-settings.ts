import {
  DEFAULT_CREDENTIAL_STYLE,
  type CredentialStyleOptions,
} from '@stateless-relay/app';

const CREDENTIAL_STYLE_STORAGE_KEY = 'stateless-relay.credentialStyle';

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

export function readStoredCredentialStyle(): CredentialStyleOptions {
  const raw = localStorage.getItem(CREDENTIAL_STYLE_STORAGE_KEY);
  if (!raw) {
    return { ...DEFAULT_CREDENTIAL_STYLE };
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return { ...DEFAULT_CREDENTIAL_STYLE };
    }
    const record = parsed as Record<string, unknown>;
    const lettersOnlyFirstSix = isBoolean(record.lettersOnlyFirstSix)
      ? record.lettersOnlyFirstSix
      : DEFAULT_CREDENTIAL_STYLE.lettersOnlyFirstSix;
    const lettersOnlyLastSix = isBoolean(record.lettersOnlyLastSix)
      ? record.lettersOnlyLastSix
      : DEFAULT_CREDENTIAL_STYLE.lettersOnlyLastSix;

    return {
      includeUppercase: isBoolean(record.includeUppercase)
        ? record.includeUppercase
        : DEFAULT_CREDENTIAL_STYLE.includeUppercase,
      includeLowercase: isBoolean(record.includeLowercase)
        ? record.includeLowercase
        : DEFAULT_CREDENTIAL_STYLE.includeLowercase,
      allowAtMostOneHyphen: isBoolean(record.allowAtMostOneHyphen)
        ? record.allowAtMostOneHyphen
        : DEFAULT_CREDENTIAL_STYLE.allowAtMostOneHyphen,
      wordStyle: isBoolean(record.wordStyle)
        ? record.wordStyle
        : DEFAULT_CREDENTIAL_STYLE.wordStyle,
      lettersOnlyFirstSix,
      lettersOnlyLastSix: lettersOnlyLastSix && !lettersOnlyFirstSix,
    };
  } catch {
    return { ...DEFAULT_CREDENTIAL_STYLE };
  }
}

export function saveStoredCredentialStyle(options: CredentialStyleOptions): void {
  localStorage.setItem(CREDENTIAL_STYLE_STORAGE_KEY, JSON.stringify(options));
}

export function getEffectiveCredentialStyle(): CredentialStyleOptions {
  return readStoredCredentialStyle();
}
