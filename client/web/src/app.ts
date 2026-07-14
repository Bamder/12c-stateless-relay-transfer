import {
  DEFAULT_MAX_RESERVATION_ATTEMPTS,
  formatCredentialStyleLabel,
  generateCredential,
  receiveFile,
  UploadTokenReservationExhaustedError,
  validateCredentialStyle,
  type CredentialStyleOptions,
} from '@stateless-relay/app';
import {
  CREDENTIAL_LENGTH,
  prepareUpload,
  prepareUploadStreamingWithHashes,
  V21_WHOLE_FILE_THRESHOLD_BYTES,
  RegistryTokenOccupiedError,
  resolveRegistryBaseUrl,
  uploadPrepared,
  type OccupiedTokenInfo,
  type UploadStatusUpdate,
  type UploadReservationMeta,
  type DownloadStatusUpdate,
  type BlockHashEntry,
  type UploadMap,
} from '@stateless-relay/transfer';
import type { ClientRuntime } from './runtime.js';
import {
  createUploadPrepareWorker,
  UPLOAD_WASM_BINARY_URL,
  UPLOAD_WASM_SCRIPT_URL,
} from './upload-worker-factory.js';
import {
  bootstrapClientRuntime,
  clearStoredRegistryUrl,
  getEffectiveFileTtlSeconds,
  loadEffectiveConfig,
  saveStoredFileTtlSeconds,
  saveStoredRegistryUrl,
} from './runtime.js';
import {
  BREATHING_MIN_MS,
  BREATHING_MIN_STREAMING_MS,
  CredentialSlotDisplay,
} from './credential-slots.js';
import { renderFileIconForFile, renderFileIconForName } from './file-type-icon.js';
import { ReceiveCredentialInput } from './receive-credential-input.js';
import { clearBanner, initBanners, showBanner } from './banner.js';
import { formatUnknownError } from './format-error.js';
import {
  clampDurationParts,
  durationPartsFromSeconds,
  formatDurationLabel,
} from './file-ttl.js';
import {
  getEffectiveCredentialStyle,
  saveStoredCredentialStyle,
} from './credential-style-settings.js';
import {
  buildReceiveUrl,
  parseReceiveIntent,
  type ReceiveUrlWarning,
} from './qr-share-link.js';
import { copyShareText, createQrSvg, downloadQrSvg } from './qr-share.js';

// ============================================================================
// 类型定义
// ============================================================================

type PanelName = 'send' | 'receive' | 'settings';

interface Elements {
  bootScreen: HTMLElement;
  bootStatus: HTMLElement;
  bootProgressBar: HTMLElement;
  app: HTMLElement;
  registryUrlLabel: HTMLElement;
  navItems: NodeListOf<HTMLButtonElement>;
  panels: NodeListOf<HTMLElement>;
  sendFileInput: HTMLInputElement;
  sendFileDropzone: HTMLLabelElement;
  sendFileEmpty: HTMLElement;
  sendFileSelected: HTMLElement;
  sendFileName: HTMLElement;
  sendFileSize: HTMLElement;
  sendFileIcon: HTMLElement;
  sendUploadStamp: HTMLElement;
  sendBtn: HTMLButtonElement;
  sendError: HTMLElement;
  sendInfo: HTMLElement;
  sendUploadStatus: HTMLElement;
  sendUploadStatusText: HTMLElement;
  sendProgressText: HTMLElement;
  sendProgressTrack: HTMLElement;
  sendProgressBar: HTMLElement;
  sendCredentialSlots: HTMLElement;
  copyCredentialBtn: HTMLButtonElement;
  sendShareSection: HTMLElement;
  sendShareTtl: HTMLElement;
  sendShareWarning: HTMLElement;
  sendShareQr: HTMLElement;
  sendShareLinkOutput: HTMLInputElement;
  copyReceiveLinkBtn: HTMLButtonElement;
  downloadReceiveQrBtn: HTMLButtonElement;
  receiveCredentialSlots: HTMLElement;
  pasteReceiveCredentialBtn: HTMLButtonElement;
  receiveDownloadBtn: HTMLButtonElement;
  receiveDownloadHint: HTMLElement;
  receiveDownloadRingFill: SVGCircleElement;
  receiveDownloadProgressHeader: HTMLElement;
  receiveDownloadStatus: HTMLElement;
  receiveDownloadSpinner: HTMLElement;
  receiveDownloadStatusText: HTMLElement;
  receiveDownloadProgressText: HTMLElement;
  receiveFileBar: HTMLButtonElement;
  receiveFilePending: HTMLElement;
  receiveFileReady: HTMLElement;
  receiveFileIcon: HTMLElement;
  receiveFileName: HTMLElement;
  receiveFileSize: HTMLElement;
  receiveFileSaveHint: HTMLElement;
  receiveError: HTMLElement;
  registryUrlInput: HTMLInputElement;
  saveSettingsBtn: HTMLButtonElement;
  resetSettingsBtn: HTMLButtonElement;
  fileTtlHoursInput: HTMLInputElement;
  fileTtlMinutesInput: HTMLInputElement;
  fileTtlSecondsInput: HTMLInputElement;
  confirmFileTtlBtn: HTMLButtonElement;
  fileTtlCurrent: HTMLElement;
  credentialStyleUppercase: HTMLInputElement;
  credentialStyleLowercase: HTMLInputElement;
  credentialStyleWord: HTMLInputElement;
  credentialStyleHyphen: HTMLInputElement;
  credentialStyleLettersLastSix: HTMLInputElement;
  credentialStyleLettersFirstSix: HTMLInputElement;
  confirmCredentialStyleBtn: HTMLButtonElement;
  credentialStyleCurrent: HTMLElement;
  settingsError: HTMLElement;
  settingsInfo: HTMLElement;
}

// ============================================================================
// 全局状态
// ============================================================================

let runtime: ClientRuntime | null = null;
let selectedFile: File | null = null;
let activePanel: PanelName = 'send';
let credentialDisplay: CredentialSlotDisplay | null = null;
let receiveCredentialInput: ReceiveCredentialInput | null = null;
let receivedFile: { fileName: string; data: Blob } | null = null;
let receiveDownloading = false;
let sendInProgress = false;
let sendShareState: { receiveUrl: string } | null = null;
let receiveIntentConsumed = false;
/** 加密阶段进度条比例，保证只增不减，避免 UI 来回晃 */
let sendPrepareProgressRatio = 0;

// ============================================================================
// 工具函数
// ============================================================================

/** 防抖：限制高频调用，默认延迟 150ms */
function debounce<T extends (...args: never[]) => void>(
  fn: T,
  delayMs = 150,
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, delayMs);
  };
}

type ReceiveDownloadState = 'idle' | 'ready' | 'downloading' | 'done';

const RECEIVE_DOWNLOAD_RING_LENGTH = 100;

const RECEIVE_DOWNLOAD_LABELS: Record<ReceiveDownloadState, string> = {
  idle: '点击下载',
  ready: '点击下载',
  downloading: '下载中',
  done: '已下载',
};

// ============================================================================
// DOM 元素收集
// ============================================================================

function $(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) {
    throw new Error(`missing element #${id}`);
  }
  return node;
}

function collectElements(): Elements {
  return {
    bootScreen: $('boot-screen'),
    bootStatus: $('boot-status'),
    bootProgressBar: $('boot-progress-bar'),
    app: $('app'),
    registryUrlLabel: $('registry-url-label'),
    navItems: document.querySelectorAll<HTMLButtonElement>('.nav-item'),
    panels: document.querySelectorAll<HTMLElement>('.panel'),
    sendFileInput: $('send-file-input') as HTMLInputElement,
    sendFileDropzone: $('send-file-dropzone') as HTMLLabelElement,
    sendFileEmpty: $('send-file-empty'),
    sendFileSelected: $('send-file-selected'),
    sendFileName: $('send-file-name'),
    sendFileSize: $('send-file-size'),
    sendFileIcon: $('send-file-icon'),
    sendUploadStamp: $('send-upload-stamp'),
    sendBtn: $('send-btn') as HTMLButtonElement,
    sendError: $('send-error'),
    sendInfo: $('send-info'),
    sendUploadStatus: $('send-upload-status'),
    sendUploadStatusText: $('send-upload-status-text'),
    sendProgressText: $('send-progress-text'),
    sendProgressTrack: $('send-progress-track'),
    sendProgressBar: $('send-progress-bar'),
    sendCredentialSlots: $('send-credential-slots'),
    copyCredentialBtn: $('copy-credential-btn') as HTMLButtonElement,
    sendShareSection: $('send-share-section'),
    sendShareTtl: $('send-share-ttl'),
    sendShareWarning: $('send-share-warning'),
    sendShareQr: $('send-share-qr'),
    sendShareLinkOutput: $('send-share-link-output') as HTMLInputElement,
    copyReceiveLinkBtn: $('copy-receive-link-btn') as HTMLButtonElement,
    downloadReceiveQrBtn: $('download-receive-qr-btn') as HTMLButtonElement,
    receiveCredentialSlots: $('receive-credential-slots'),
    pasteReceiveCredentialBtn: $('paste-receive-credential-btn') as HTMLButtonElement,
    receiveDownloadBtn: $('receive-download-btn') as HTMLButtonElement,
    receiveDownloadHint: $('receive-download-hint'),
    receiveDownloadRingFill: (() => {
      const node = document.getElementById('receive-download-ring-fill');
      if (!(node instanceof SVGCircleElement)) {
        throw new Error('missing element #receive-download-ring-fill');
      }
      return node;
    })(),
    receiveDownloadProgressHeader: $('receive-download-progress-header'),
    receiveDownloadStatus: $('receive-download-status'),
    receiveDownloadSpinner: $('receive-download-spinner'),
    receiveDownloadStatusText: $('receive-download-status-text'),
    receiveDownloadProgressText: $('receive-download-progress-text'),
    receiveFileBar: $('receive-file-bar') as HTMLButtonElement,
    receiveFilePending: $('receive-file-pending'),
    receiveFileReady: $('receive-file-ready'),
    receiveFileIcon: $('receive-file-icon'),
    receiveFileName: $('receive-file-name'),
    receiveFileSize: $('receive-file-size'),
    receiveFileSaveHint: $('receive-file-save-hint'),
    receiveError: $('receive-error'),
    registryUrlInput: $('registry-url-input') as HTMLInputElement,
    saveSettingsBtn: $('save-settings-btn') as HTMLButtonElement,
    resetSettingsBtn: $('reset-settings-btn') as HTMLButtonElement,
    fileTtlHoursInput: $('file-ttl-hours') as HTMLInputElement,
    fileTtlMinutesInput: $('file-ttl-minutes') as HTMLInputElement,
    fileTtlSecondsInput: $('file-ttl-seconds') as HTMLInputElement,
    confirmFileTtlBtn: $('confirm-file-ttl-btn') as HTMLButtonElement,
    fileTtlCurrent: $('file-ttl-current'),
    credentialStyleUppercase: $('credential-style-uppercase') as HTMLInputElement,
    credentialStyleLowercase: $('credential-style-lowercase') as HTMLInputElement,
    credentialStyleWord: $('credential-style-word') as HTMLInputElement,
    credentialStyleHyphen: $('credential-style-hyphen') as HTMLInputElement,
    credentialStyleLettersLastSix: $('credential-style-letters-last-six') as HTMLInputElement,
    credentialStyleLettersFirstSix: $('credential-style-letters-first-six') as HTMLInputElement,
    confirmCredentialStyleBtn: $('confirm-credential-style-btn') as HTMLButtonElement,
    credentialStyleCurrent: $('credential-style-current'),
    settingsError: $('settings-error'),
    settingsInfo: $('settings-info'),
  };
}

const el = collectElements();

function formatBytes(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

/** Whole-transfer byte progress: stable denominator, monotonic numerator. */
function formatTransferBytesProgress(
  transferred: number | undefined,
  total: number | undefined,
): string {
  if (
    total === undefined ||
    !Number.isFinite(total) ||
    total <= 0 ||
    transferred === undefined ||
    !Number.isFinite(transferred)
  ) {
    return '';
  }
  return `（${formatBytes(Math.max(0, transferred))} / ${formatBytes(total)}）`;
}

/** Prefetch window before SMB: (? / ceiling) until bytes start flowing. */
function formatPrefetchBytesProgress(
  received: number | undefined,
  ceiling: number | undefined,
): string {
  if (
    ceiling === undefined ||
    !Number.isFinite(ceiling) ||
    ceiling <= 0
  ) {
    return '';
  }
  const left =
    received !== undefined &&
    Number.isFinite(received) &&
    received > 0
      ? formatBytes(received)
      : '- MB';
  return `（${left} / 最高 ${formatBytes(ceiling)}）`;
}

function setBootProgress(ratio: number, message: string): void {
  el.bootStatus.textContent = message;
  el.bootProgressBar.style.width = `${Math.max(0, Math.min(100, ratio * 100))}%`;
}

function showApp(): void {
  el.bootScreen.classList.add('hidden');
  el.app.classList.remove('hidden');
}

// ============================================================================
// 导航与面板切换
// ============================================================================

function switchPanel(panel: PanelName): void {
  activePanel = panel;
  el.navItems.forEach((item) => {
    item.classList.toggle('active', item.dataset.panel === panel);
  });
  el.panels.forEach((section) => {
    section.classList.toggle('active', section.id === `panel-${panel}`);
  });
}

function updateRegistryLabel(): void {
  el.registryUrlLabel.textContent = runtime?.registryUrl ?? '—';
}

// ============================================================================
// 运行时与启动
// ============================================================================

async function reloadRuntime(): Promise<void> {
  setBootProgress(0.35, '正在连接 Registry…');
  runtime = await bootstrapClientRuntime();
  updateRegistryLabel();
  el.registryUrlInput.value = runtime.registryUrl;
}

function requireRuntime(): ClientRuntime {
  if (!runtime) {
    throw new Error('客户端尚未就绪');
  }
  return runtime;
}

// ============================================================================
// 发送面板 - 文件选择与 UI 状态
// ============================================================================

function clearUploadStamp(): void {
  el.sendUploadStamp.classList.remove('visible');
  el.sendUploadStamp.classList.add('hidden');
  el.sendFileDropzone.classList.remove('is-uploaded');
}

function showUploadStamp(): void {
  el.sendUploadStamp.classList.remove('hidden');
  requestAnimationFrame(() => {
    el.sendUploadStamp.classList.add('visible');
  });
  el.sendFileDropzone.classList.add('is-uploaded');
}

function updateSendControls(): void {
  el.sendBtn.disabled = sendInProgress || !selectedFile;
  el.sendFileInput.disabled = sendInProgress;
  el.fileTtlHoursInput.disabled = sendInProgress;
  el.fileTtlMinutesInput.disabled = sendInProgress;
  el.fileTtlSecondsInput.disabled = sendInProgress;
  el.confirmFileTtlBtn.disabled = sendInProgress;
  el.sendFileDropzone.classList.toggle('is-disabled', sendInProgress);
  el.sendFileDropzone.toggleAttribute('aria-disabled', sendInProgress);
}

function updateSendFilePicker(): void {
  if (!selectedFile) {
    el.sendFileDropzone.classList.remove('has-file');
    el.sendFileEmpty.classList.remove('hidden');
    el.sendFileSelected.classList.add('hidden');
    clearUploadStamp();
    updateSendControls();
    return;
  }

  clearUploadStamp();
  el.sendFileDropzone.classList.add('has-file');
  el.sendFileEmpty.classList.add('hidden');
  el.sendFileSelected.classList.remove('hidden');
  renderFileIconForFile(el.sendFileIcon, selectedFile);
  el.sendFileName.textContent = selectedFile.name;
  el.sendFileSize.textContent = formatBytes(selectedFile.size);
  updateSendControls();
}

function formatUploadStatusMessage(
  status: UploadStatusUpdate | { phase: 'reading' },
): string {
  switch (status.phase) {
    case 'reading':
      return '正在读取文件';
    case 'preparing':
      if (
        status.segmentTotal !== undefined &&
        status.segmentTotal > 1 &&
        status.segmentIndex !== undefined &&
        status.segmentIndex > 0
      ) {
        return `正在加密并分块（GCM 段 ${status.segmentIndex} / ${status.segmentTotal}）`;
      }
      if (
        status.bytesFed !== undefined &&
        status.totalBytes !== undefined &&
        status.totalBytes > 0
      ) {
        return '正在加密并分块';
      }
      return '正在加密并分块';
    case 'hashing':
      return status.total > 1
        ? `正在计算块哈希（${status.index} / ${status.total}）`
        : '正在计算块哈希';
    case 'reserving':
      return '等待服务器返回各块的定位结果';
    case 'uploading':
      if (status.completed >= status.total) {
        return '上传完成';
      }
      if (status.completed === 0 && status.inFlight > 0) {
        return status.total > 1
          ? `正在上传首批数据（0 / ${status.total} 已完成，${status.inFlight} 路已发出）`
          : '正在上传';
      }
      return status.total > 1
        ? `正在上传（${status.completed} / ${status.total} 块已完成${status.inFlight > 0 ? `，${status.inFlight} 路进行中` : ''}）`
        : '正在上传';
    default:
      return '正在处理';
  }
}

function setSendUploadStatus(
  status: UploadStatusUpdate | { phase: 'reading' } | null,
): void {
  if (!status) {
    el.sendUploadStatus.classList.add('hidden');
    el.sendProgressTrack.classList.remove('indeterminate');
    sendPrepareProgressRatio = 0;
    return;
  }

  el.sendUploadStatus.classList.remove('hidden');
  el.sendUploadStatusText.textContent = formatUploadStatusMessage(status);

  if (
    status.phase === 'preparing' &&
    status.bytesFed !== undefined &&
    status.totalBytes !== undefined &&
    status.totalBytes > 0
  ) {
    el.sendProgressText.textContent = `${formatBytes(status.bytesFed)} / ${formatBytes(status.totalBytes)}`;
    el.sendProgressTrack.classList.remove('indeterminate');
    const ratio = Math.max(
      sendPrepareProgressRatio,
      status.bytesFed / status.totalBytes,
    );
    sendPrepareProgressRatio = ratio;
    el.sendProgressBar.style.width = `${Math.max(4, Math.round(ratio * 100))}%`;
    return;
  }

  if (status.phase === 'hashing' && status.total > 0) {
    el.sendProgressText.textContent = `${status.index} / ${status.total}`;
    el.sendProgressTrack.classList.remove('indeterminate');
    const ratio = status.index / status.total;
    el.sendProgressBar.style.width = `${Math.max(4, Math.round(ratio * 100))}%`;
    return;
  }

  if (status.phase === 'uploading') {
    sendPrepareProgressRatio = 0;
    const transferHint = formatTransferBytesProgress(
      status.transferBytesTransferred,
      status.transferBytesTotal,
    );
    el.sendProgressText.textContent =
      status.inFlight > 0
        ? `${status.completed} / ${status.total}（${status.inFlight} 进行中）${transferHint}`
        : `${status.completed} / ${status.total}${transferHint}`;
    if (status.completed >= status.total) {
      el.sendProgressTrack.classList.remove('indeterminate');
      el.sendProgressBar.style.width = '100%';
      return;
    }
    if (status.completed === 0 && status.inFlight > 0) {
      el.sendProgressTrack.classList.add('indeterminate');
      el.sendProgressBar.style.width = '';
      return;
    }
    el.sendProgressTrack.classList.remove('indeterminate');
    const ratio = status.total > 0 ? status.completed / status.total : 0;
    el.sendProgressBar.style.width = `${Math.max(4, Math.round(ratio * 100))}%`;
    return;
  }

  el.sendProgressTrack.classList.add('indeterminate');
  el.sendProgressBar.style.width = '';
  el.sendProgressText.textContent = '';
}

function resetSendProgress(): void {
  setSendUploadStatus(null);
  el.sendProgressBar.style.width = '0%';
  el.sendProgressText.textContent = '';
}

function resetSendCredential(): void {
  credentialDisplay?.reset();
  el.copyCredentialBtn.disabled = true;
}

function clearSendShare(): void {
  sendShareState = null;
  el.sendShareSection.classList.add('hidden');
  el.sendShareTtl.textContent = '';
  el.sendShareWarning.textContent = '';
  el.sendShareWarning.classList.add('hidden');
  el.sendShareQr.replaceChildren();
  el.sendShareLinkOutput.value = '';
  el.copyReceiveLinkBtn.disabled = true;
  el.copyReceiveLinkBtn.textContent = '复制接收链接';
  el.downloadReceiveQrBtn.disabled = true;
}

function formatShareWarnings(warnings: readonly ReceiveUrlWarning[]): string {
  const messages: string[] = [];
  if (warnings.includes('loopback')) {
    messages.push('当前 Registry 是本机回环地址，其他设备通常无法访问此二维码。');
  }
  if (warnings.includes('insecure')) {
    messages.push('当前链接使用 HTTP；公网分享请改用 HTTPS，避免提取凭证被窃取。');
  }
  return messages.join(' ');
}

function showSendShare(
  credential: string,
  requestedTtlSeconds: number,
  reservation: UploadReservationMeta | undefined,
): void {
  clearSendShare();
  el.sendShareSection.classList.remove('hidden');

  const grantedTtlSeconds =
    reservation?.grantedTtlSeconds ?? requestedTtlSeconds;
  el.sendShareTtl.textContent =
    `服务器实际有效时长：${formatDurationLabel(grantedTtlSeconds)}` +
    '（从上传预留时开始计时）';

  try {
    const client = requireRuntime();
    const receiveUrl = buildReceiveUrl(client.registryUrl, credential);
    const qrSvg = createQrSvg(receiveUrl.url);
    sendShareState = { receiveUrl: receiveUrl.url };
    el.sendShareLinkOutput.value = receiveUrl.url;
    el.sendShareQr.innerHTML = qrSvg;
    el.copyReceiveLinkBtn.disabled = false;
    el.downloadReceiveQrBtn.disabled = false;

    const warning = formatShareWarnings(receiveUrl.warnings);
    if (warning) {
      el.sendShareWarning.textContent = warning;
      el.sendShareWarning.classList.remove('hidden');
    }
  } catch (error) {
    el.sendShareWarning.textContent =
      `文件已上传，但无法生成可扫码链接：${formatUnknownError(error)}`;
    el.sendShareWarning.classList.remove('hidden');
  }
}

function resetSendPanel(): void {
  resetSendCredential();
  resetSendProgress();
  clearUploadStamp();
  clearSendShare();
}

function formatUploadReservationDegradedMessage(
  reservation: UploadReservationMeta,
): string {
  const parts: string[] = [];
  if (reservation.grantedTtlSeconds < reservation.requestedTtlSeconds) {
    parts.push(
      `上传有效期已由 ${formatDurationLabel(reservation.requestedTtlSeconds)} 调整为 ${formatDurationLabel(reservation.grantedTtlSeconds)}`,
    );
  }
  const plan = reservation.placementPlan;
  if (plan && plan.relayCount < plan.idealRelayCount) {
    parts.push(
      `备份/分散布局已降级（${plan.relayCount}/${plan.idealRelayCount} 台 Relay）`,
    );
  }
  if (parts.length === 0) {
    return 'Registry 已降级上传分配策略（当前 Relay 存储能力或冗余不足）。';
  }
  return `${parts.join('；')}（当前 Relay 存储能力或冗余不足）。`;
}

// ============================================================================
// 发送面板 - 上传流程
// ============================================================================

async function handleSend(): Promise<void> {
  clearBanner(el.sendError);
  clearBanner(el.sendInfo);
  resetSendPanel();

  if (!selectedFile) {
    showBanner(el.sendError, '请先选择文件');
    return;
  }

  const ttlParts = readDurationInputs();
  if (ttlParts.totalSeconds <= 0) {
    showBanner(el.sendError, '文件与二维码有效期必须大于 0 秒');
    return;
  }
  applyDurationPartsToInputs(ttlParts);
  saveStoredFileTtlSeconds(ttlParts.totalSeconds);
  updateFileTtlCurrentLabel(ttlParts.totalSeconds);
  const requestedTtlSeconds = ttlParts.totalSeconds;

  const client = requireRuntime();
  const display = credentialDisplay;
  if (!display) {
    throw new Error('credential display not initialized');
  }

  el.copyCredentialBtn.disabled = true;
  sendInProgress = true;
  updateSendControls();
  display.startBreathing();

  try {
    const useStreamingUpload =
      selectedFile.size > V21_WHOLE_FILE_THRESHOLD_BYTES;
    const bytesPromise = useStreamingUpload
      ? Promise.resolve(selectedFile.size)
      : selectedFile.arrayBuffer().then((buffer) => new Uint8Array(buffer));
    if (!useStreamingUpload) {
      setSendUploadStatus({ phase: 'reading' });
    }
    await display.enterReelWhenReady(
      bytesPromise,
      useStreamingUpload ? BREATHING_MIN_STREAMING_MS : BREATHING_MIN_MS,
    );
    const bytes = useStreamingUpload
      ? null
      : ((await bytesPromise) as Uint8Array);

    const maxAttempts = DEFAULT_MAX_RESERVATION_ATTEMPTS;
    let lastOccupiedTokens: OccupiedTokenInfo[] = [];

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const credential = generateCredential(getEffectiveCredentialStyle());

      try {
        let uploads: UploadMap;
        let blockHashes: BlockHashEntry[] | undefined;
        const wirePrepareOptions = {
          relayMaxBodyBytes: client.relayMaxBodyBytes,
          createUploadWorker: createUploadPrepareWorker,
          wasmScriptUrl: UPLOAD_WASM_SCRIPT_URL,
          wasmBinaryUrl: UPLOAD_WASM_BINARY_URL,
        };
        if (useStreamingUpload) {
          const prepared = await prepareUploadStreamingWithHashes(
            selectedFile,
            credential,
            client.twelveC,
            selectedFile.name,
            undefined,
            (status) => setSendUploadStatus(status),
            wirePrepareOptions,
          );
          uploads = prepared.uploads;
          blockHashes = prepared.blockHashes;
        } else {
          setSendUploadStatus({ phase: 'preparing' });
          uploads = prepareUpload(
            bytes!,
            credential,
            client.twelveC,
            selectedFile.name,
            undefined,
            {
              relayMaxBodyBytes: client.relayMaxBodyBytes,
            },
          );
        }
        await display.revealSequential(credential);
        el.copyCredentialBtn.disabled = false;

        const { replicaSync, reservation } = await uploadPrepared(
          uploads,
          client.stack.router,
          client.stack.uploadClient,
          {
            registry: client.stack.registry,
            ttlSeconds: requestedTtlSeconds,
            precomputedBlockHashes: blockHashes,
          },
          (status: UploadStatusUpdate) => {
            setSendUploadStatus(status);
          },
        );

        setSendUploadStatus(null);
        el.sendProgressBar.style.width = '100%';
        el.sendProgressText.textContent = `${uploads.size} / ${uploads.size}`;

        if (reservation?.degraded) {
          showBanner(
            el.sendInfo,
            formatUploadReservationDegradedMessage(reservation),
          );
        }

        showSendShare(credential, requestedTtlSeconds, reservation);
        showUploadStamp();
        void replicaSync?.catch(() => {
          /* replica 后台补传失败不影响主流程 */
        });
        return;
      } catch (error) {
        if (!(error instanceof RegistryTokenOccupiedError)) {
          throw error;
        }

        lastOccupiedTokens = (error as RegistryTokenOccupiedError).occupiedTokens;
        display.startReelSpinning();

        if (attempt < maxAttempts) {
          continue;
        }
      }
    }

    throw new UploadTokenReservationExhaustedError(maxAttempts, lastOccupiedTokens);
  } catch (error) {
    setSendUploadStatus(null);
    const message = formatUnknownError(error);
    showBanner(el.sendError, message);
    if (!display.getValue()) {
      display.reset();
    }
  } finally {
    sendInProgress = false;
    updateSendControls();
  }
}

// ============================================================================
// 接收面板 - 文件下载与保存
// ============================================================================

function saveBlob(filename: string, data: Blob): void {
  const url = URL.createObjectURL(data);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function resetReceiveFileBar(): void {
  receivedFile = null;
  el.receiveFileBar.disabled = true;
  el.receiveFileBar.classList.remove('receive-file-bar--ready');
  el.receiveFileBar.classList.add('receive-file-bar--pending');
  el.receiveFileBar.classList.remove('is-clickable');
  el.receiveFilePending.classList.remove('hidden');
  el.receiveFileReady.classList.add('hidden');
  el.receiveFileSaveHint.classList.add('hidden');
  el.receiveFileIcon.replaceChildren();
  el.receiveFileName.textContent = '';
  el.receiveFileSize.textContent = '';
}

function formatDownloadStatusMessage(status: DownloadStatusUpdate): string {
  switch (status.phase) {
    case 'resolving_initial': {
      const from = status.fromIndex + 1;
      const to = status.toIndex;
      if (to <= from) {
        return `正在定位初始接收窗口（共 ${status.total} 块，包含SMB）`;
      }
      return `正在定位初始接收窗口（第 ${from}–${to} 块，共 ${status.total} 块，包含SMB）`;
    }
    case 'resolving_window': {
      const from = status.fromIndex + 1;
      const to = status.toIndex;
      if (to <= from) {
        return `正在定位接收窗口（共 ${status.total} 块）`;
      }
      return `正在定位接收窗口（第 ${from}–${to} 块，共 ${status.total} 块）`;
    }
    case 'awaiting_metadata_block': {
      const n = status.prefetchCount ?? 0;
      const bytesHint = formatPrefetchBytesProgress(
        status.prefetchBytesReceived,
        status.prefetchBytesCeiling,
      );
      if (n > 1) {
        return `正在预获取 ${n} 块数据${bytesHint}`;
      }
      if (n === 1) {
        return `正在预获取 1 块数据${bytesHint}`;
      }
      return `正在预获取数据${bytesHint}`;
    }
    case 'waiting_metadata_block':
      if (status.reason === 'registry') {
        return '等待发送方上传（首块尚未就绪，将自动继续）';
      }
      return '首块传输不稳定，正在自动重试';
    case 'parsing_metadata':
      return '正在解析 SMB';
    case 'downloading':
      if (status.completed >= status.total) {
        return '下载完成';
      }
      if (status.completed === 0 && (status.inFlight ?? 0) > 0) {
        return status.total > 1
          ? `正在下载首批数据（0 / ${status.total} 已完成，${status.inFlight} 路已发出）`
          : '正在下载';
      }
      if (status.completed === 1 && status.total > 1) {
        const lanes =
          (status.inFlight ?? 0) > 0 ? `，${status.inFlight} 路进行中` : '';
        return `正在下载（SMB 已就绪，${status.completed} / ${status.total} 块已完成${lanes}）`;
      }
      return status.total > 1
        ? `正在下载（${status.completed} / ${status.total} 块已完成${
            (status.inFlight ?? 0) > 0 ? `，${status.inFlight} 路进行中` : ''
          }）`
        : '正在下载';
    case 'decrypting':
      return '正在解密文件内容';
    default:
      return '正在处理';
  }
}

function isPreBlockProgressPhase(status: DownloadStatusUpdate): boolean {
  return (
    status.phase === 'resolving_initial' ||
    status.phase === 'awaiting_metadata_block' ||
    status.phase === 'waiting_metadata_block' ||
    status.phase === 'parsing_metadata'
  );
}

function setReceiveDownloadStatus(status: DownloadStatusUpdate | null): void {
  if (!status) {
    el.receiveDownloadProgressHeader.classList.add('hidden');
    el.receiveDownloadSpinner.classList.add('hidden');
    el.receiveDownloadStatusText.textContent = '';
    return;
  }

  el.receiveDownloadProgressHeader.classList.remove('hidden');
  el.receiveDownloadSpinner.classList.remove('hidden');
  el.receiveDownloadStatusText.textContent = formatDownloadStatusMessage(status);
}

let receiveDownloadStatusRank = 0;
let receiveDownloadBlockProgress: {
  completed: number;
  total: number;
  transferBytesTransferred?: number;
  transferBytesTotal?: number;
} | null = null;
let receiveDownloadBlockProgressLocked = false;
let receivePrefetchByteProgress: {
  received: number;
  ceiling: number;
} | null = null;

function paintReceiveDownloadBlockProgress(): void {
  if (receiveDownloadBlockProgress === null) {
    return;
  }
  const {
    completed,
    total,
    transferBytesTransferred,
    transferBytesTotal,
  } = receiveDownloadBlockProgress;
  const transferHint = formatTransferBytesProgress(
    transferBytesTransferred,
    transferBytesTotal,
  );
  el.receiveDownloadProgressText.classList.remove('hidden');
  el.receiveDownloadProgressText.textContent = transferHint
    ? `${completed} / ${total}${transferHint}`
    : `${completed} / ${total}`;
  el.receiveDownloadRingFill.style.strokeDasharray = '';
  const ratio = total > 0 ? completed / total : 0;
  el.receiveDownloadRingFill.style.strokeDashoffset = String(
    RECEIVE_DOWNLOAD_RING_LENGTH * (1 - ratio),
  );
}

function rememberReceiveDownloadBlockProgress(
  completed: number,
  total: number,
  transferBytesTransferred?: number,
  transferBytesTotal?: number,
): void {
  receiveDownloadBlockProgress = {
    completed,
    total,
    ...(transferBytesTransferred !== undefined
      ? { transferBytesTransferred }
      : {}),
    ...(transferBytesTotal !== undefined ? { transferBytesTotal } : {}),
  };
  receiveDownloadBlockProgressLocked = true;
}

const RECEIVE_DOWNLOAD_PHASE_RANK: Record<DownloadStatusUpdate['phase'], number> =
  {
    resolving_initial: 10,
    awaiting_metadata_block: 20,
    waiting_metadata_block: 25,
    parsing_metadata: 30,
    resolving_window: 35,
    downloading: 40,
    decrypting: 50,
  };

function paintReceivePrefetchByteProgress(): void {
  if (receivePrefetchByteProgress === null) {
    return;
  }
  const hint = formatPrefetchBytesProgress(
    receivePrefetchByteProgress.received,
    receivePrefetchByteProgress.ceiling,
  );
  if (!hint) {
    return;
  }
  el.receiveDownloadProgressText.classList.remove('hidden');
  el.receiveDownloadProgressText.textContent = hint.replace(/^（|）$/g, '');
}

function setReceiveDownloadProgress(status: DownloadStatusUpdate | null): void {
  if (status === null) {
    receiveDownloadStatusRank = 0;
    receiveDownloadBlockProgress = null;
    receiveDownloadBlockProgressLocked = false;
    receivePrefetchByteProgress = null;
    el.receiveDownloadProgressHeader.classList.add('hidden');
    el.receiveDownloadSpinner.classList.add('hidden');
    el.receiveDownloadStatusText.textContent = '';
    el.receiveDownloadProgressText.classList.add('hidden');
    el.receiveDownloadProgressText.textContent = '';
    el.receiveDownloadRingFill.style.strokeDashoffset = '0';
    return;
  }

  if (status.phase === 'resolving_window') {
    // After block progress is live, keep downloading text; resolve is just
    // background steering for the sliding window and must not cover it.
    if (receiveDownloadBlockProgressLocked) {
      paintReceiveDownloadBlockProgress();
      return;
    }
    receiveDownloadStatusRank = Math.max(
      receiveDownloadStatusRank,
      RECEIVE_DOWNLOAD_PHASE_RANK.resolving_window,
    );
    el.receiveDownloadBtn.classList.remove(
      'receive-download-trigger--ring-indeterminate',
    );
    setReceiveDownloadStatus(status);
    return;
  }

  if (status.phase === 'awaiting_metadata_block') {
    if (
      status.prefetchBytesCeiling !== undefined &&
      status.prefetchBytesCeiling > 0
    ) {
      receivePrefetchByteProgress = {
        received: Math.max(
          receivePrefetchByteProgress?.received ?? 0,
          status.prefetchBytesReceived ?? 0,
        ),
        ceiling: status.prefetchBytesCeiling,
      };
    }
  }

  const rank = RECEIVE_DOWNLOAD_PHASE_RANK[status.phase];
  if (rank < receiveDownloadStatusRank) {
    if (receiveDownloadBlockProgressLocked) {
      paintReceiveDownloadBlockProgress();
    } else if (receivePrefetchByteProgress !== null) {
      // e.g. waiting_metadata_block text is newer; keep refreshing byte totals.
      paintReceivePrefetchByteProgress();
    }
    return;
  }
  receiveDownloadStatusRank = rank;

  if (status.phase === 'downloading') {
    receivePrefetchByteProgress = null;
    rememberReceiveDownloadBlockProgress(
      status.completed,
      status.total,
      status.transferBytesTransferred,
      status.transferBytesTotal,
    );
  }

  el.receiveDownloadBtn.classList.remove('receive-download-trigger--ring-indeterminate');
  setReceiveDownloadStatus(status);

  if (receiveDownloadBlockProgressLocked) {
    paintReceiveDownloadBlockProgress();
    return;
  }

  if (status.phase === 'awaiting_metadata_block') {
    el.receiveDownloadRingFill.style.strokeDasharray = '';
    el.receiveDownloadRingFill.style.strokeDashoffset = '';
    el.receiveDownloadBtn.classList.add(
      'receive-download-trigger--ring-indeterminate',
    );
    paintReceivePrefetchByteProgress();
    return;
  }

  if (
    status.phase === 'waiting_metadata_block' &&
    receivePrefetchByteProgress !== null
  ) {
    el.receiveDownloadRingFill.style.strokeDasharray = '';
    el.receiveDownloadRingFill.style.strokeDashoffset = '';
    el.receiveDownloadBtn.classList.add(
      'receive-download-trigger--ring-indeterminate',
    );
    paintReceivePrefetchByteProgress();
    return;
  }

  if (isPreBlockProgressPhase(status)) {
    el.receiveDownloadProgressText.classList.add('hidden');
    el.receiveDownloadProgressText.textContent = '';
    el.receiveDownloadRingFill.style.strokeDasharray = '';
    el.receiveDownloadRingFill.style.strokeDashoffset = '';
    el.receiveDownloadBtn.classList.add('receive-download-trigger--ring-indeterminate');
    return;
  }

  el.receiveDownloadRingFill.style.strokeDasharray = '';

  if (status.phase === 'downloading') {
    paintReceiveDownloadBlockProgress();
    return;
  }

  if (status.phase === 'decrypting') {
    el.receiveDownloadProgressText.classList.remove('hidden');
    el.receiveDownloadProgressText.textContent = `${status.total} / ${status.total}`;
    el.receiveDownloadRingFill.style.strokeDashoffset = '0';
  }
}

function setReceiveDownloadVisual(state: ReceiveDownloadState): void {
  el.receiveDownloadBtn.classList.remove(
    'receive-download-trigger--idle',
    'receive-download-trigger--ready',
    'receive-download-trigger--downloading',
    'receive-download-trigger--done',
  );
  el.receiveDownloadBtn.classList.add(`receive-download-trigger--${state}`);
  el.receiveDownloadHint.textContent = RECEIVE_DOWNLOAD_LABELS[state];
  el.receiveDownloadBtn.setAttribute('aria-label', RECEIVE_DOWNLOAD_LABELS[state]);
}

function updateReceiveDownloadButton(): void {
  if (receiveDownloading) {
    setReceiveDownloadVisual('downloading');
    el.receiveDownloadBtn.disabled = true;
    return;
  }
  if (receivedFile) {
    setReceiveDownloadVisual('done');
    el.receiveDownloadBtn.disabled = true;
    return;
  }
  const complete = receiveCredentialInput?.isComplete() === true;
  setReceiveDownloadVisual(complete ? 'ready' : 'idle');
  el.receiveDownloadBtn.disabled = !complete;
}

function showReceivedFile(
  fileName: string,
  data: Blob,
  autoSaveAttempted = false,
): void {
  receivedFile = { fileName, data };
  el.receiveFileBar.disabled = false;
  el.receiveFileBar.classList.remove('receive-file-bar--pending');
  el.receiveFileBar.classList.add('receive-file-bar--ready', 'is-clickable');
  el.receiveFilePending.classList.add('hidden');
  el.receiveFileReady.classList.remove('hidden');
  el.receiveFileSaveHint.classList.remove('hidden');
  el.receiveFileSaveHint.textContent = autoSaveAttempted
    ? '已尝试自动保存；若浏览器未保存，请点击此处'
    : '点击保存到本地';
  renderFileIconForName(el.receiveFileIcon, fileName);
  el.receiveFileName.textContent = fileName;
  el.receiveFileSize.textContent = formatBytes(data.size);
  updateReceiveDownloadButton();
}

function handleSaveReceivedFile(): void {
  if (!receivedFile) {
    return;
  }
  saveBlob(receivedFile.fileName, receivedFile.data);
}

async function handleReceiveDownload(
  options: { autoSave?: boolean } = {},
): Promise<void> {
  if (receiveDownloading) {
    return;
  }
  clearBanner(el.receiveError);
  const credential = receiveCredentialInput?.getValue() ?? '';
  if (credential.length !== CREDENTIAL_LENGTH) {
    showBanner(el.receiveError, `凭证必须为 ${CREDENTIAL_LENGTH} 位`);
    return;
  }

  const client = requireRuntime();
  receiveDownloading = true;
  updateReceiveDownloadButton();

  try {
    const received = await receiveFile(credential, {
      twelveC: client.twelveC,
      receiveTransport: client.stack.receiveTransport,
    }, {
      relayMaxBodyBytes: client.relayMaxBodyBytes,
      onStatus: (status) => setReceiveDownloadProgress(status),
    });
    showReceivedFile(received.fileName, received.data, options.autoSave === true);
    if (options.autoSave) {
      try {
        saveBlob(received.fileName, received.data);
      } catch (saveError) {
        console.warn('[receive] automatic save was blocked:', saveError);
        el.receiveFileSaveHint.textContent = '浏览器未能自动保存，请点击此处';
      }
    }
  } catch (error) {
    console.error('[receive] download failed:', error);
    const message = formatUnknownError(error);
    showBanner(el.receiveError, message);
  } finally {
    receiveDownloading = false;
    setReceiveDownloadProgress(null);
    updateReceiveDownloadButton();
  }
}

// ============================================================================
// 设置面板 - 文件有效期 (TTL)
// ============================================================================

function applyDurationPartsToInputs(parts: ReturnType<typeof durationPartsFromSeconds>): void {
  el.fileTtlHoursInput.value = String(parts.hours);
  el.fileTtlMinutesInput.value = String(parts.minutes);
  el.fileTtlSecondsInput.value = String(parts.seconds);
}

function updateFileTtlCurrentLabel(totalSeconds: number): void {
  el.fileTtlCurrent.textContent = formatDurationLabel(totalSeconds);
}

function syncFileTtlSettingsUi(): void {
  const totalSeconds = getEffectiveFileTtlSeconds();
  applyDurationPartsToInputs(durationPartsFromSeconds(totalSeconds));
  updateFileTtlCurrentLabel(totalSeconds);
}

function readDurationInputs(): ReturnType<typeof clampDurationParts> {
  return clampDurationParts(
    Number(el.fileTtlHoursInput.value),
    Number(el.fileTtlMinutesInput.value),
    Number(el.fileTtlSecondsInput.value),
  );
}

function handleConfirmFileTtl(): void {
  clearBanner(el.sendError);
  clearBanner(el.sendInfo);

  const parts = readDurationInputs();
  if (parts.totalSeconds <= 0) {
    showBanner(el.sendError, '文件与二维码有效期必须大于 0 秒');
    return;
  }

  applyDurationPartsToInputs(parts);
  saveStoredFileTtlSeconds(parts.totalSeconds);
  updateFileTtlCurrentLabel(parts.totalSeconds);
  showBanner(el.sendInfo, '文件与二维码有效期已更新。');
}

// ============================================================================
// 设置面板 - 凭证风格
// ============================================================================

function lettersEnabledForCredentialStyle(): boolean {
  return el.credentialStyleUppercase.checked || el.credentialStyleLowercase.checked;
}

function updateWordStyleCheckboxState(): void {
  const enabled = lettersEnabledForCredentialStyle();
  el.credentialStyleWord.disabled = !enabled;
  if (!enabled) {
    el.credentialStyleWord.checked = false;
  }
}

function readCredentialStyleFromInputs(): CredentialStyleOptions {
  const lettersOnlyFirstSix = el.credentialStyleLettersFirstSix.checked;
  const lettersOnlyLastSix =
    el.credentialStyleLettersLastSix.checked && !lettersOnlyFirstSix;
  const includeUppercase = el.credentialStyleUppercase.checked;
  const includeLowercase = el.credentialStyleLowercase.checked;

  return {
    includeUppercase,
    includeLowercase,
    allowAtMostOneHyphen: el.credentialStyleHyphen.checked,
    lettersOnlyLastSix,
    lettersOnlyFirstSix,
    wordStyle:
      el.credentialStyleWord.checked && (includeUppercase || includeLowercase),
  };
}

function applyCredentialStyleToInputs(options: CredentialStyleOptions): void {
  const lettersOnlyFirstSix = options.lettersOnlyFirstSix;
  const lettersOnlyLastSix =
    options.lettersOnlyLastSix && !lettersOnlyFirstSix;

  el.credentialStyleUppercase.checked = options.includeUppercase;
  el.credentialStyleLowercase.checked = options.includeLowercase;
  el.credentialStyleHyphen.checked = options.allowAtMostOneHyphen;
  el.credentialStyleWord.checked = options.wordStyle;
  el.credentialStyleLettersLastSix.checked = lettersOnlyLastSix;
  el.credentialStyleLettersFirstSix.checked = lettersOnlyFirstSix;
  updateWordStyleCheckboxState();
}

function updateCredentialStyleCurrentLabel(options: CredentialStyleOptions): void {
  el.credentialStyleCurrent.textContent = formatCredentialStyleLabel(options);
}

function syncCredentialStyleSettingsUi(): void {
  const options = getEffectiveCredentialStyle();
  applyCredentialStyleToInputs(options);
  updateCredentialStyleCurrentLabel(options);
}

function handleConfirmCredentialStyle(): void {
  clearBanner(el.settingsError);
  clearBanner(el.settingsInfo);

  const options = readCredentialStyleFromInputs();
  const validationError = validateCredentialStyle(options);
  if (validationError) {
    showBanner(el.settingsError, validationError);
    return;
  }

  saveStoredCredentialStyle(options);
  updateCredentialStyleCurrentLabel(options);
  showBanner(el.settingsInfo, '凭证风格已更新。');
}

// ============================================================================
// 设置面板 - Registry 连接
// ============================================================================

async function handleSaveSettings(): Promise<void> {
  clearBanner(el.settingsError);
  clearBanner(el.settingsInfo);

  const url = el.registryUrlInput.value.trim();
  if (!url) {
    showBanner(el.settingsError, 'Registry URL 不能为空');
    return;
  }

  saveStoredRegistryUrl(url);
  el.bootScreen.classList.remove('hidden');
  el.app.classList.add('hidden');
  setBootProgress(0.2, '正在重连 Registry…');

  try {
    await reloadRuntime();
    clearSendShare();
    showApp();
    showBanner(el.settingsInfo, '已保存并重连 Registry。');
    if (activePanel !== 'settings') {
      switchPanel('settings');
    }
  } catch (error) {
    const message = formatUnknownError(error);
    showBanner(el.settingsError, message);
    showApp();
  }
}

async function handleResetSettings(): Promise<void> {
  clearBanner(el.settingsError);
  clearBanner(el.settingsInfo);
  clearStoredRegistryUrl();

  const config = await loadEffectiveConfig();
  el.registryUrlInput.value = resolveRegistryBaseUrl(config.registry);
  showBanner(el.settingsInfo, '已恢复默认（尚未重连，请点击保存并重连）。');
}

async function pasteReceiveCredential(): Promise<void> {
  clearBanner(el.receiveError);
  try {
    const text = await navigator.clipboard.readText();
    if (!text.trim()) {
      showBanner(el.receiveError, '剪贴板为空，请先在发送页复制凭证');
      return;
    }
    receiveCredentialInput?.applyCredential(text);
    if (!receiveCredentialInput?.isComplete()) {
      showBanner(el.receiveError, `剪贴板内容不足 ${CREDENTIAL_LENGTH} 位有效凭证字符`);
      return;
    }
  } catch {
    showBanner(el.receiveError, '无法读取剪贴板，请在凭证框内 Ctrl+V 粘贴');
  }
}

async function copyCredential(): Promise<void> {
  const value = credentialDisplay?.getValue();
  if (!value) {
    return;
  }
  await navigator.clipboard.writeText(value);
  showBanner(el.sendInfo, '凭证已复制到剪贴板。');
}

async function copyReceiveLink(): Promise<void> {
  const state = sendShareState;
  if (!state) {
    return;
  }

  clearBanner(el.sendError);
  try {
    await copyShareText(state.receiveUrl);
    el.copyReceiveLinkBtn.textContent = '已复制';
    window.setTimeout(() => {
      if (sendShareState === state) {
        el.copyReceiveLinkBtn.textContent = '复制接收链接';
      }
    }, 1600);
  } catch (error) {
    showBanner(el.sendError, `复制接收链接失败：${formatUnknownError(error)}`);
  }
}

function downloadReceiveQr(): void {
  if (!sendShareState) {
    return;
  }
  clearBanner(el.sendError);
  try {
    downloadQrSvg(el.sendShareQr);
  } catch (error) {
    showBanner(el.sendError, `保存二维码失败：${formatUnknownError(error)}`);
  }
}

function clearConsumedReceiveHash(): void {
  const cleanUrl = new URL(window.location.href);
  cleanUrl.hash = '';
  window.history.replaceState(window.history.state, '', cleanUrl.toString());
}

async function consumeReceiveLinkIntent(): Promise<void> {
  if (receiveIntentConsumed) {
    return;
  }

  const intent = parseReceiveIntent(window.location.hash);
  if (intent.kind === 'none') {
    return;
  }

  receiveIntentConsumed = true;
  clearConsumedReceiveHash();
  switchPanel('receive');

  if (intent.kind === 'invalid') {
    showBanner(el.receiveError, '接收链接无效或已损坏，请让发送方重新生成二维码。');
    return;
  }

  receiveCredentialInput?.applyCredential(intent.credential);
  if (!receiveCredentialInput?.isComplete()) {
    showBanner(el.receiveError, '接收链接中的凭证无效，请让发送方重新生成二维码。');
    return;
  }

  if (intent.autoDownload) {
    await handleReceiveDownload({ autoSave: true });
    return;
  }

  el.receiveDownloadBtn.focus();
}

// ============================================================================
// 事件绑定
// ============================================================================

function bindEvents(): void {
  el.navItems.forEach((item) => {
    item.addEventListener('click', () => {
      const panel = item.dataset.panel as PanelName | undefined;
      if (panel) {
        switchPanel(panel);
      }
    });
  });

  el.sendFileInput.addEventListener('change', () => {
    if (sendInProgress) {
      return;
    }
    selectedFile = el.sendFileInput.files?.[0] ?? null;
    updateSendFilePicker();
    resetSendPanel();
    clearBanner(el.sendError);
    clearBanner(el.sendInfo);
  });

  el.sendBtn.addEventListener('click', () => {
    if (sendInProgress) {
      return;
    }
    void handleSend();
  });

  el.receiveDownloadBtn.addEventListener('click', () => {
    void handleReceiveDownload();
  });

  el.receiveFileBar.addEventListener('click', () => {
    handleSaveReceivedFile();
  });

  el.saveSettingsBtn.addEventListener('click', () => {
    void handleSaveSettings();
  });

  el.resetSettingsBtn.addEventListener('click', () => {
    void handleResetSettings();
  });

  el.confirmFileTtlBtn.addEventListener('click', () => {
    handleConfirmFileTtl();
  });

  el.confirmCredentialStyleBtn.addEventListener('click', () => {
    handleConfirmCredentialStyle();
  });

  el.credentialStyleLettersFirstSix.addEventListener('change', () => {
    if (el.credentialStyleLettersFirstSix.checked) {
      el.credentialStyleLettersLastSix.checked = false;
    }
  });

  el.credentialStyleLettersLastSix.addEventListener('change', () => {
    if (el.credentialStyleLettersLastSix.checked) {
      el.credentialStyleLettersFirstSix.checked = false;
    }
  });

  for (const input of [el.credentialStyleUppercase, el.credentialStyleLowercase]) {
    input.addEventListener('change', () => {
      updateWordStyleCheckboxState();
    });
  }

  const debouncedSyncTtl = debounce(() => {
    const parts = readDurationInputs();
    applyDurationPartsToInputs(parts);
  }, 200);

  for (const input of [el.fileTtlHoursInput, el.fileTtlMinutesInput, el.fileTtlSecondsInput]) {
    input.addEventListener('input', () => {
      debouncedSyncTtl();
    });
    input.addEventListener('change', () => {
      const parts = readDurationInputs();
      applyDurationPartsToInputs(parts);
    });
  }

  el.copyCredentialBtn.addEventListener('click', () => {
    void copyCredential();
  });

  el.copyReceiveLinkBtn.addEventListener('click', () => {
    void copyReceiveLink();
  });

  el.downloadReceiveQrBtn.addEventListener('click', () => {
    downloadReceiveQr();
  });

  el.pasteReceiveCredentialBtn.addEventListener('click', () => {
    void pasteReceiveCredential();
  });
}

export async function startApp(): Promise<void> {
  initBanners();
  bindEvents();
  credentialDisplay = new CredentialSlotDisplay(el.sendCredentialSlots);
  receiveCredentialInput = new ReceiveCredentialInput(el.receiveCredentialSlots);
  receiveCredentialInput.onChange(() => {
    resetReceiveFileBar();
    if (!receiveDownloading) {
      setReceiveDownloadProgress(null);
    }
    updateReceiveDownloadButton();
    clearBanner(el.receiveError);
  });
  clearSendShare();
  resetReceiveFileBar();
  updateReceiveDownloadButton();
  syncFileTtlSettingsUi();
  syncCredentialStyleSettingsUi();
  setBootProgress(0.1, '正在加载加密模块…');

  try {
    setBootProgress(0.25, '正在读取配置…');
    await reloadRuntime();
    setBootProgress(1, '就绪');
    showApp();
    await consumeReceiveLinkIntent();
  } catch (error) {
    const message = formatUnknownError(error);
    el.bootStatus.textContent = `启动失败：${message}`;
    el.bootProgressBar.style.width = '0%';
  }
}
