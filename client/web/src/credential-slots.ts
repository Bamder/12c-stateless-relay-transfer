import { CREDENTIAL_LENGTH } from '@stateless-relay/transfer';

const WAITING_TEXT = 'WAITING4-12C';
export const BREATHING_MIN_MS = 900;
/** 流式大文件：缩短 WAITING 呼吸，尽快进入滚筒阶段并保持至 reveal */
export const BREATHING_MIN_STREAMING_MS = 280;
const REEL_SPIN_INTERVAL_MS = 70;
const REVEAL_STEP_MS = 70;

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
    this.stopReelTimer();
    this.credential = '';
    for (const slot of this.slots) {
      slot.textContent = '';
      slot.className = 'credential-slot credential-slot--empty';
    }
  }

  /** 显示 WAITING4-12C 呼吸动画（文件导入阶段）。 */
  startBreathing(): void {
    this.stopReelTimer();
    this.credential = '';

    if (WAITING_TEXT.length !== CREDENTIAL_LENGTH) {
      throw new Error('WAITING_TEXT must match CREDENTIAL_LENGTH');
    }

    for (let index = 0; index < CREDENTIAL_LENGTH; index++) {
      const slot = this.slots[index]!;
      slot.className = 'credential-slot credential-slot--spinning credential-slot--waiting';
      slot.textContent = WAITING_TEXT[index]!;
    }
  }

  /**
   * 呼吸至少 minBreathingMs，且 importReady 完成后进入滚筒：
   * 全部字符蓝色滚动，直至 revealSequential。
   */
  async enterReelWhenReady(
    importReady: Promise<unknown>,
    minBreathingMs = BREATHING_MIN_MS,
  ): Promise<void> {
    await Promise.all([delay(minBreathingMs), importReady]);
    this.startReelSpinning();
  }

  /** 全格蓝色随机滚动（加密阶段保持此状态）。 */
  startReelSpinning(): void {
    this.stopReelTimer();

    for (const slot of this.slots) {
      slot.className = 'credential-slot credential-slot--spinning';
      slot.textContent = randomChar();
    }

    this.spinTimer = window.setInterval(() => {
      for (const slot of this.slots) {
        if (slot.classList.contains('credential-slot--spinning')) {
          slot.textContent = randomChar();
        }
      }
    }, REEL_SPIN_INTERVAL_MS);
  }

  /** 加密完成后：逐格停到正确字符并变绿，相邻间隔 stepMs。 */
  async revealSequential(
    credential: string,
    stepMs = REVEAL_STEP_MS,
  ): Promise<void> {
    if (credential.length !== CREDENTIAL_LENGTH) {
      throw new Error(`credential length must be ${CREDENTIAL_LENGTH}`);
    }

    this.credential = credential;

    for (let index = 0; index < CREDENTIAL_LENGTH; index++) {
      const slot = this.slots[index]!;
      slot.className = 'credential-slot credential-slot--settled';
      slot.textContent = credential[index]!;

      if (index < CREDENTIAL_LENGTH - 1) {
        await delay(stepMs);
      }
    }

    this.stopReelTimer();
  }

  private stopReelTimer(): void {
    if (this.spinTimer !== null) {
      window.clearInterval(this.spinTimer);
      this.spinTimer = null;
    }
  }
}
