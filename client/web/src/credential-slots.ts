import { CREDENTIAL_LENGTH } from '@stateless-relay/transfer';

const WAITING_TEXT = 'WAITING4-12C';

const SPIN_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function randomChar(): string {
  return SPIN_ALPHABET[Math.floor(Math.random() * SPIN_ALPHABET.length)]!;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export class CredentialSlotDisplay {
  private readonly slots: HTMLElement[] = [];
  private spinTimer: number | null = null;
  private waitingTimer: number | null = null;
  private credential = '';

  constructor(container: HTMLElement) {
    container.replaceChildren();
    for (let index = 0; index < CREDENTIAL_LENGTH; index++) {
      const slot = document.createElement('div');
      slot.className = 'credential-slot credential-slot--empty';
      slot.setAttribute('aria-label', `凭证第 ${index + 1} 位`);
      container.appendChild(slot);
      this.slots.push(slot);
    }
  }

  getValue(): string {
    return this.credential;
  }

  reset(): void {
    this.stopSpinning();
    this.credential = '';
    for (const slot of this.slots) {
      slot.textContent = '';
      slot.className = 'credential-slot credential-slot--empty';
    }
  }

  startSpinning(): void {
    this.stopSpinning();
    this.credential = '';

    if (WAITING_TEXT.length !== CREDENTIAL_LENGTH) {
      throw new Error('WAITING_TEXT must match CREDENTIAL_LENGTH');
    }

    for (let index = 0; index < CREDENTIAL_LENGTH; index++) {
      const slot = this.slots[index]!;
      slot.className = 'credential-slot credential-slot--spinning credential-slot--waiting';
      slot.textContent = WAITING_TEXT[index]!;
    }

    this.waitingTimer = window.setTimeout(() => {
      this.waitingTimer = null;
      for (const slot of this.slots) {
        slot.classList.remove('credential-slot--waiting');
      }
      this.spinTimer = window.setInterval(() => {
        for (const slot of this.slots) {
          if (slot.classList.contains('credential-slot--spinning')) {
            slot.textContent = randomChar();
          }
        }
      }, 70);
    }, 900);
  }

  stopSpinning(): void {
    if (this.waitingTimer !== null) {
      window.clearTimeout(this.waitingTimer);
      this.waitingTimer = null;
    }
    if (this.spinTimer !== null) {
      window.clearInterval(this.spinTimer);
      this.spinTimer = null;
    }
  }

  /** 逐格减速停到最终凭证字符（老虎机落位）。 */
  async reveal(credential: string): Promise<void> {
    if (credential.length !== CREDENTIAL_LENGTH) {
      throw new Error(`credential length must be ${CREDENTIAL_LENGTH}`);
    }

    this.stopSpinning();
    this.credential = credential;

    for (let index = 0; index < CREDENTIAL_LENGTH; index++) {
      const slot = this.slots[index]!;
      const finalChar = credential[index]!;

      for (let tick = 0; tick < 6; tick++) {
        slot.textContent = randomChar();
        await delay(45 + tick * 8);
      }

      slot.className = 'credential-slot credential-slot--settled';
      slot.textContent = finalChar;
      await delay(90);
    }

    this.stopSpinning();
  }
}
