import { CREDENTIAL_LENGTH } from '@stateless-relay/transfer';

const CREDENTIAL_CHAR = /^[A-Za-z0-9-]$/;

export class ReceiveCredentialInput {
  private readonly inputs: HTMLInputElement[] = [];
  private onChangeCallback: (() => void) | null = null;

  constructor(container: HTMLElement) {
    container.replaceChildren();
    container.classList.add('credential-slots', 'credential-slots--input');

    for (let index = 0; index < CREDENTIAL_LENGTH; index++) {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'credential-slot credential-slot--input';
      input.maxLength = 1;
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.inputMode = 'text';
      input.setAttribute('aria-label', `凭证第 ${index + 1} 位`);
      input.dataset.index = String(index);

      input.addEventListener('input', () => {
        this.normalizeInput(input);
        if (input.value.length === 1 && index < CREDENTIAL_LENGTH - 1) {
          this.inputs[index + 1]?.focus();
        }
        this.notifyChange();
      });

      input.addEventListener('keydown', (event) => {
        if (event.key === 'Backspace' && input.value === '' && index > 0) {
          const prev = this.inputs[index - 1]!;
          prev.focus();
          prev.select();
          event.preventDefault();
        }
        if (event.key === 'ArrowLeft' && index > 0) {
          this.inputs[index - 1]?.focus();
          event.preventDefault();
        }
        if (event.key === 'ArrowRight' && index < CREDENTIAL_LENGTH - 1) {
          this.inputs[index + 1]?.focus();
          event.preventDefault();
        }
      });

      input.addEventListener('paste', (event) => {
        event.preventDefault();
        const text = event.clipboardData?.getData('text') ?? '';
        this.applyText(text, index);
        this.notifyChange();
      });

      container.appendChild(input);
      this.inputs.push(input);
    }
  }

  onChange(callback: () => void): void {
    this.onChangeCallback = callback;
  }

  getValue(): string {
    return this.inputs.map((input) => input.value).join('');
  }

  isComplete(): boolean {
    return this.getValue().length === CREDENTIAL_LENGTH;
  }

  reset(): void {
    for (const input of this.inputs) {
      input.value = '';
    }
    this.inputs[0]?.focus();
    this.notifyChange();
  }

  focus(): void {
    const firstEmpty = this.inputs.find((input) => input.value === '');
    (firstEmpty ?? this.inputs[0])?.focus();
  }

  private notifyChange(): void {
    this.onChangeCallback?.();
  }

  private normalizeInput(input: HTMLInputElement): void {
    const char = input.value.slice(-1);
    if (char === '') {
      input.value = '';
      return;
    }
    if (!CREDENTIAL_CHAR.test(char)) {
      input.value = '';
      return;
    }
    input.value = char;
  }

  private applyText(text: string, startIndex: number): void {
    const chars = text.replace(/\s/g, '').slice(0, CREDENTIAL_LENGTH - startIndex);
    for (let offset = 0; offset < chars.length; offset++) {
      const char = chars[offset]!;
      if (!CREDENTIAL_CHAR.test(char)) {
        continue;
      }
      const input = this.inputs[startIndex + offset];
      if (!input) {
        break;
      }
      input.value = char;
    }
    const next = this.inputs[Math.min(startIndex + chars.length, CREDENTIAL_LENGTH - 1)];
    next?.focus();
  }
}
