import { CREDENTIAL_LENGTH } from '@stateless-relay/transfer';

export interface CredentialStyleOptions {
  includeUppercase: boolean;
  includeLowercase: boolean;
  allowAtMostOneHyphen: boolean;
  lettersOnlyLastSix: boolean;
  lettersOnlyFirstSix: boolean;
  wordStyle: boolean;
}

export const DEFAULT_CREDENTIAL_STYLE: CredentialStyleOptions = {
  includeUppercase: true,
  includeLowercase: true,
  allowAtMostOneHyphen: false,
  lettersOnlyLastSix: false,
  lettersOnlyFirstSix: false,
  wordStyle: false,
};

const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
const VOWELS_LOWER = 'aeiou';
const VOWELS_UPPER = 'AEIOU';
const CONSONANTS_LOWER = 'bcdfghjklmnpqrstvwxyz';
const CONSONANTS_UPPER = 'BCDFGHJKLMNPQRSTVWXYZ';
const FORBIDDEN_TRAILING_CONSONANTS = new Set(['h', 'z', 'q', 'j', 'k', 'l', 'm']);
const WORD_STYLE_UPPERCASE_LEADING_POSITIONS = new Set([0, 6]);
const WORD_STYLE_HYPHEN_POSITIONS = [5, 6];
const SYLLABLE_LENGTH = 3;

function isFirstHalf(index: number): boolean {
  return index < CREDENTIAL_LENGTH / 2;
}

function isLetterOnlyPosition(index: number, options: CredentialStyleOptions): boolean {
  if (options.lettersOnlyLastSix && !isFirstHalf(index)) {
    return true;
  }
  if (options.lettersOnlyFirstSix && isFirstHalf(index)) {
    return true;
  }
  return false;
}

function isDigitOnlyPosition(index: number, options: CredentialStyleOptions): boolean {
  if (options.lettersOnlyLastSix && isFirstHalf(index)) {
    return true;
  }
  if (options.lettersOnlyFirstSix && !isFirstHalf(index)) {
    return true;
  }
  return false;
}

function letterCharset(options: CredentialStyleOptions): string {
  let charset = '';
  if (options.includeUppercase) {
    charset += UPPERCASE;
  }
  if (options.includeLowercase) {
    charset += LOWERCASE;
  }
  return charset;
}

function charsetForPosition(index: number, options: CredentialStyleOptions): string {
  const letters = letterCharset(options);
  if (isLetterOnlyPosition(index, options)) {
    return letters;
  }
  if (isDigitOnlyPosition(index, options)) {
    return DIGITS;
  }
  return letters + DIGITS;
}

function pickRandomChar(charset: string, randomByte: number): string {
  return charset[randomByte % charset.length]!;
}

function canUseWordStyle(options: CredentialStyleOptions): boolean {
  return options.includeUppercase || options.includeLowercase;
}

export function validateCredentialStyle(options: CredentialStyleOptions): string | null {
  if (options.lettersOnlyFirstSix && options.lettersOnlyLastSix) {
    return '「字母仅在前6位」与「字母仅在后6位」不能同时启用';
  }

  if (options.wordStyle && !canUseWordStyle(options)) {
    return '启用单词风格时，请至少勾选一种英文字母';
  }

  const letters = letterCharset(options);
  for (let index = 0; index < CREDENTIAL_LENGTH; index++) {
    if (charsetForPosition(index, options).length === 0) {
      return '当前凭证风格无法生成有效凭证，请至少启用一种字母并检查位置限制';
    }
  }
  if (letters.length === 0 && !options.allowAtMostOneHyphen) {
    for (let index = 0; index < CREDENTIAL_LENGTH; index++) {
      if (isLetterOnlyPosition(index, options)) {
        return '当前凭证风格无法生成有效凭证，请至少启用一种字母并检查位置限制';
      }
    }
  }
  return null;
}

interface WordStyleLayout {
  wordStart: number;
  syllableCount: number;
  digitPrefixLength: number;
  digitSuffixLength: number;
}

function resolveWordStyleLayout(options: CredentialStyleOptions): WordStyleLayout {
  if (options.lettersOnlyFirstSix) {
    return {
      wordStart: 0,
      syllableCount: 2,
      digitPrefixLength: 0,
      digitSuffixLength: CREDENTIAL_LENGTH / 2,
    };
  }
  if (options.lettersOnlyLastSix) {
    return {
      wordStart: CREDENTIAL_LENGTH / 2,
      syllableCount: 2,
      digitPrefixLength: CREDENTIAL_LENGTH / 2,
      digitSuffixLength: 0,
    };
  }
  return {
    wordStart: 0,
    syllableCount: CREDENTIAL_LENGTH / SYLLABLE_LENGTH,
    digitPrefixLength: 0,
    digitSuffixLength: 0,
  };
}

function listConsonantSlots(layout: WordStyleLayout): number[] {
  const slots: number[] = [];
  for (let syllableIndex = 0; syllableIndex < layout.syllableCount; syllableIndex++) {
    const base = layout.wordStart + syllableIndex * SYLLABLE_LENGTH;
    slots.push(base, base + 2);
  }
  return slots;
}

function canLeadingConsonantBeUppercase(baseIndex: number): boolean {
  return WORD_STYLE_UPPERCASE_LEADING_POSITIONS.has(baseIndex);
}

function shouldUseLeadingUppercase(options: CredentialStyleOptions, randomByte: number): boolean {
  if (options.includeUppercase && options.includeLowercase) {
    return randomByte % 2 === 1;
  }
  return options.includeUppercase;
}

function pickConsonant(options: CredentialStyleOptions, uppercase: boolean, randomByte: number): string {
  if (uppercase && options.includeUppercase) {
    return pickRandomChar(CONSONANTS_UPPER, randomByte);
  }
  if (options.includeLowercase) {
    return pickRandomChar(CONSONANTS_LOWER, randomByte);
  }
  return pickRandomChar(CONSONANTS_UPPER, randomByte);
}

function buildTrailingConsonantCharset(vowel: string): string {
  const vowelLower = vowel.toLowerCase();
  const allowY = vowelLower === 'a';
  const allowW = vowelLower === 'o';
  let charset = '';
  for (const char of CONSONANTS_LOWER) {
    if (FORBIDDEN_TRAILING_CONSONANTS.has(char)) {
      continue;
    }
    if (char === 'y' && !allowY) {
      continue;
    }
    if (char === 'w' && !allowW) {
      continue;
    }
    charset += char;
  }
  return charset;
}

function pickTrailingConsonant(
  vowel: string,
  randomByte: number,
): string {
  const charset = buildTrailingConsonantCharset(vowel);
  if (charset.length === 0) {
    throw new Error(`no valid trailing consonant for vowel ${vowel}`);
  }
  return pickRandomChar(charset, randomByte);
}

function pickVowel(options: CredentialStyleOptions, uppercase: boolean, randomByte: number): string {
  if (uppercase && options.includeUppercase) {
    return pickRandomChar(VOWELS_UPPER, randomByte);
  }
  if (options.includeLowercase) {
    return pickRandomChar(VOWELS_LOWER, randomByte);
  }
  return pickRandomChar(VOWELS_UPPER, randomByte);
}

function generateCvcSyllable(
  options: CredentialStyleOptions,
  baseIndex: number,
  hyphenIndex: number | null,
  randomBytes: Uint8Array,
  randomOffset: number,
): { text: string; nextOffset: number } {
  let offset = randomOffset;
  const nextByte = () => randomBytes[offset++] ?? 0;

  const leadingWouldUpper =
    canLeadingConsonantBeUppercase(baseIndex) &&
    shouldUseLeadingUppercase(options, nextByte());
  const useHyphenAtLeading = hyphenIndex === baseIndex;
  const useHyphenAtTrailing = hyphenIndex === baseIndex + 2;

  const leading = useHyphenAtLeading
    ? '-'
    : pickConsonant(options, leadingWouldUpper, nextByte());

  const vowelUpper = useHyphenAtLeading && leadingWouldUpper;
  const vowel = pickVowel(options, vowelUpper, nextByte());

  const trailing = useHyphenAtTrailing
    ? '-'
    : pickTrailingConsonant(vowel, nextByte());

  return {
    text: `${leading}${vowel}${trailing}`,
    nextOffset: offset,
  };
}

function listWordStyleHyphenSlots(layout: WordStyleLayout): number[] {
  const consonantSlots = new Set(listConsonantSlots(layout));
  return WORD_STYLE_HYPHEN_POSITIONS.filter((slot) => consonantSlots.has(slot));
}

function generateWordStyleCredential(options: CredentialStyleOptions): string {
  const layout = resolveWordStyleLayout(options);
  const chars = Array.from({ length: CREDENTIAL_LENGTH }, () => '');

  const randomBytes = new Uint8Array(CREDENTIAL_LENGTH * 4);
  crypto.getRandomValues(randomBytes);
  let offset = 0;
  const nextByte = () => randomBytes[offset++] ?? 0;

  for (let index = 0; index < layout.digitPrefixLength; index++) {
    chars[index] = pickRandomChar(DIGITS, nextByte());
  }

  const digitSuffixStart = CREDENTIAL_LENGTH - layout.digitSuffixLength;
  for (let index = digitSuffixStart; index < CREDENTIAL_LENGTH; index++) {
    chars[index] = pickRandomChar(DIGITS, nextByte());
  }

  const hyphenSlots = listWordStyleHyphenSlots(layout);
  let hyphenIndex: number | null = null;
  if (options.allowAtMostOneHyphen && hyphenSlots.length > 0 && nextByte() % 2 === 1) {
    hyphenIndex = hyphenSlots[nextByte() % hyphenSlots.length]!;
  }

  for (let syllableIndex = 0; syllableIndex < layout.syllableCount; syllableIndex++) {
    const base = layout.wordStart + syllableIndex * SYLLABLE_LENGTH;
    const syllable = generateCvcSyllable(options, base, hyphenIndex, randomBytes, offset);
    offset = syllable.nextOffset;
    for (let index = 0; index < SYLLABLE_LENGTH; index++) {
      chars[base + index] = syllable.text[index]!;
    }
  }

  return chars.join('');
}

function pickHyphenIndex(options: CredentialStyleOptions, randomByte: number): number | null {
  if (!options.allowAtMostOneHyphen) {
    return null;
  }
  if (randomByte % 2 === 0) {
    return null;
  }

  const validPositions: number[] = [];
  for (let index = 0; index < CREDENTIAL_LENGTH; index++) {
    if (!isLetterOnlyPosition(index, options)) {
      validPositions.push(index);
    }
  }
  if (validPositions.length === 0) {
    return null;
  }
  return validPositions[randomByte % validPositions.length]!;
}

function generateRandomCredential(options: CredentialStyleOptions): string {
  const randomBytes = new Uint8Array(CREDENTIAL_LENGTH + 1);
  crypto.getRandomValues(randomBytes);
  const hyphenIndex = pickHyphenIndex(options, randomBytes[0]!);

  let credential = '';
  for (let index = 0; index < CREDENTIAL_LENGTH; index++) {
    if (index === hyphenIndex) {
      credential += '-';
      continue;
    }
    const charset = charsetForPosition(index, options);
    credential += pickRandomChar(charset, randomBytes[index + 1]!);
  }
  return credential;
}

export function generateStyledCredential(
  options: CredentialStyleOptions = DEFAULT_CREDENTIAL_STYLE,
): string {
  const validationError = validateCredentialStyle(options);
  if (validationError) {
    throw new Error(validationError);
  }

  if (options.wordStyle) {
    return generateWordStyleCredential(options);
  }
  return generateRandomCredential(options);
}

export function formatCredentialStyleLabel(options: CredentialStyleOptions): string {
  const parts: string[] = [];
  if (options.includeUppercase) {
    parts.push('大写字母');
  }
  if (options.includeLowercase) {
    parts.push('小写字母');
  }
  if (options.wordStyle) {
    parts.push('单词风格');
  }
  if (options.allowAtMostOneHyphen) {
    parts.push('至多一个短横杠');
  }
  if (options.lettersOnlyFirstSix) {
    parts.push('字母仅在前6位');
  }
  if (options.lettersOnlyLastSix) {
    parts.push('字母仅在后6位');
  }
  return parts.length > 0 ? parts.join('、') : '未设置';
}
