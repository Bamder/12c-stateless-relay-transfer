import {
  DEFAULT_CREDENTIAL_STYLE,
  generateStyledCredential,
  type CredentialStyleOptions,
} from './credential-style.js';

export type { CredentialStyleOptions } from './credential-style.js';
export {
  DEFAULT_CREDENTIAL_STYLE,
  formatCredentialStyleLabel,
  validateCredentialStyle,
} from './credential-style.js';

/**
 * 随机生成 12 位带外传输凭证（searchCode + keyCode 各 6 位）。
 */
export function generateCredential(
  options: CredentialStyleOptions = DEFAULT_CREDENTIAL_STYLE,
): string {
  return generateStyledCredential(options);
}
