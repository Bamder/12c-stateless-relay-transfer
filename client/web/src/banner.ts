function ensureBannerStructure(target: HTMLElement): HTMLElement {
  let messageEl = target.querySelector<HTMLElement>('.banner-message');
  if (!messageEl) {
    messageEl = document.createElement('span');
    messageEl.className = 'banner-message';
    target.appendChild(messageEl);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'banner-close';
    closeBtn.setAttribute('aria-label', '关闭');
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => clearBanner(target));
    target.appendChild(closeBtn);
  }
  return messageEl;
}

export function showBanner(target: HTMLElement, message: string): void {
  ensureBannerStructure(target).textContent = message;
  target.classList.remove('hidden');
}

export function clearBanner(target: HTMLElement): void {
  ensureBannerStructure(target).textContent = '';
  target.classList.add('hidden');
}

export function initBanners(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('.banner').forEach((banner) => {
    ensureBannerStructure(banner);
  });
}
