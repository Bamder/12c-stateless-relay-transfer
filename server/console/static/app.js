const WELCOME_LEAVE_MS = 520;
/** 侧边栏服务状态；每次 ≈ 2 次本地 /health + 端口探测 */
const SERVICE_POLL_MS = 5000;
/** 当前主面板概览；仅在前台且已进入 Console 时运行 */
const PANEL_POLL_MS = 30000;
/** 刷新图标旋转一圈 0.65s，至少播放一圈 */
const REFRESH_ANIM_MIN_MS = 650;
/** 从锚点移向气泡时的隐藏延迟，便于鼠标移入气泡复制 */
const TOOLTIP_HIDE_DELAY_MS = 280;

const state = {
  consoleEntered: false,
  panel: "registry",
  view: "main",
  dbActiveTab: { registry: null, relay: null },
  dbCache: { registry: null, relay: null },
  relays: [],
  contextRelay: null,
  contextDbRow: null,
  contextService: null,
  pendingRemovals: new Set(),
  refreshing: false,
  panelPolling: false,
  servicePending: {
    registry: null,
    relay: null,
  },
  servicesStatus: null,
  lastRelayOverview: null,
  refreshFabObserver: null,
  relayPanelConfig: null,
  tooltipOverFloat: false,
  tooltipHideTimer: null,
};

const el = {
  welcomeScreen: document.getElementById("welcome-screen"),
  appLayout: document.getElementById("app-layout"),
  welcomeCards: document.querySelectorAll(".welcome-card"),
  navItems: document.querySelectorAll(".nav-item"),
  panels: document.querySelectorAll(".panel"),
  relayGrid: document.getElementById("relay-grid"),
  registryMainView: document.getElementById("registry-main-view"),
  registryDbView: document.getElementById("registry-db-view"),
  registryDbTabs: document.getElementById("registry-db-tabs"),
  registryDb: document.getElementById("registry-db"),
  registryDbBtn: document.getElementById("registry-db-btn"),
  registryDbBackBtn: document.getElementById("registry-db-back-btn"),
  registryError: document.getElementById("registry-error"),
  registryInfo: document.getElementById("registry-info"),
  relayMainView: document.getElementById("relay-main-view"),
  relayDbView: document.getElementById("relay-db-view"),
  relayDbTabs: document.getElementById("relay-db-tabs"),
  relayOverview: document.getElementById("relay-overview"),
  relayDb: document.getElementById("relay-db"),
  relayDbBtn: document.getElementById("relay-db-btn"),
  relayDbBackBtn: document.getElementById("relay-db-back-btn"),
  relayError: document.getElementById("relay-error"),
  relayInfo: document.getElementById("relay-info"),
  relayRegisterBtn: document.getElementById("relay-register-btn"),
  relayRegisterDialog: document.getElementById("relay-register-dialog"),
  relayRegisterForm: document.getElementById("relay-register-form"),
  relayRegisterError: document.getElementById("relay-register-error"),
  fillLocalRegistryBtn: document.getElementById("fill-local-registry-btn"),
  relayPublicUrlDialog: document.getElementById("relay-public-url-dialog"),
  relayPublicUrlForm: document.getElementById("relay-public-url-form"),
  relayPublicUrlError: document.getElementById("relay-public-url-error"),
  fillLocalRelayUrlBtn: document.getElementById("fill-local-relay-url-btn"),
  contextMenu: document.getElementById("context-menu"),
  dbContextMenu: document.getElementById("db-context-menu"),
  serviceContextMenu: document.getElementById("service-context-menu"),
  registrationInboxBtn: document.getElementById("registration-inbox-btn"),
  registrationInboxBadge: document.getElementById("registration-inbox-badge"),
  registrationInboxDialog: document.getElementById("registration-inbox-dialog"),
  registrationInboxList: document.getElementById("registration-inbox-list"),
  registrationInboxError: document.getElementById("registration-inbox-error"),
  registrationInboxCloseBtn: document.getElementById("registration-inbox-close-btn"),
  manageRelayDialog: document.getElementById("manage-relay-dialog"),
  manageRelayForm: document.getElementById("manage-relay-form"),
  manageRelayTitle: document.getElementById("manage-relay-title"),
  registryRefreshBtn: document.getElementById("registry-refresh-btn"),
  relayRefreshBtn: document.getElementById("relay-refresh-btn"),
  refreshFab: document.getElementById("refresh-fab"),
  mainScroll: document.querySelector(".main"),
  registryServiceDot: document.getElementById("registry-service-dot"),
  relayServiceDot: document.getElementById("relay-service-dot"),
  registryServiceHint: document.getElementById("registry-service-hint"),
  relayServiceHint: document.getElementById("relay-service-hint"),
  startRegistryBtn: document.getElementById("start-registry-btn"),
  startRelayBtn: document.getElementById("start-relay-btn"),
  urlTooltipFloat: document.getElementById("url-tooltip-float"),
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  if (!response.ok) {
    const detail =
      payload && typeof payload === "object" && payload.detail
        ? String(payload.detail)
        : `HTTP ${response.status}`;
    throw new Error(detail);
  }
  return payload;
}

function ensureBannerStructure(target) {
  if (!target) {
    return null;
  }
  let messageEl = target.querySelector(".banner-message");
  if (!messageEl) {
    messageEl = document.createElement("span");
    messageEl.className = "banner-message";
    target.appendChild(messageEl);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "banner-close";
    closeBtn.setAttribute("aria-label", "关闭");
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", () => clearError(target));
    target.appendChild(closeBtn);
  }
  return messageEl;
}

function initBanners(root = document) {
  root.querySelectorAll(".banner").forEach((banner) => {
    ensureBannerStructure(banner);
  });
}

function showError(target, message) {
  if (!target) {
    return;
  }
  ensureBannerStructure(target).textContent = message;
  target.classList.remove("hidden");
}

function clearError(target) {
  if (!target) {
    return;
  }
  ensureBannerStructure(target).textContent = "";
  target.classList.add("hidden");
}

function clearInfo(target) {
  clearError(target);
}

function clearPanelBanners() {
  clearInfo(el.registryInfo);
  clearError(el.registryError);
  clearInfo(el.relayInfo);
  clearError(el.relayError);
}

function showInfo(target, message) {
  showError(target, message);
}

function visibleRelays(relays) {
  return relays.filter((relay) => relay.enabled !== false);
}

function setRefreshBusy(busy) {
  state.refreshing = busy;
  for (const button of [el.registryRefreshBtn, el.relayRefreshBtn, el.refreshFab]) {
    if (!button) continue;
    button.disabled = busy;
    button.dataset.busy = busy ? "true" : "false";
  }
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function finishRefreshBusy(startedAt) {
  const remaining = REFRESH_ANIM_MIN_MS - (Date.now() - startedAt);
  if (remaining > 0) {
    await delay(remaining);
  }
  setRefreshBusy(false);
}

function activeRefreshBtn() {
  return state.panel === "registry" ? el.registryRefreshBtn : el.relayRefreshBtn;
}

function updateRefreshFabVisibility(primaryVisible) {
  if (!el.refreshFab) return;
  const showFab =
    state.consoleEntered && !isDatabaseView() && !document.hidden && !primaryVisible;
  el.refreshFab.classList.toggle("refresh-fab--visible", showFab);
  el.refreshFab.setAttribute("aria-hidden", showFab ? "false" : "true");
}

function observeActiveRefreshBtn() {
  if (!el.refreshFabObserver || !el.refreshFab) return;
  el.refreshFabObserver.disconnect();
  if (!state.consoleEntered || isDatabaseView()) {
    updateRefreshFabVisibility(true);
    return;
  }
  const button = activeRefreshBtn();
  if (!button) {
    updateRefreshFabVisibility(true);
    return;
  }
  el.refreshFabObserver.observe(button);
}

function initRefreshFab() {
  if (!el.refreshFab) return;

  el.refreshFab.addEventListener("click", async () => {
    await handleRefresh();
  });

  el.refreshFabObserver = new IntersectionObserver(
    ([entry]) => {
      updateRefreshFabVisibility(entry.isIntersecting);
    },
    { root: null, threshold: 0 },
  );

  observeActiveRefreshBtn();
}

function panelDbElements(panelSource) {
  if (panelSource === "registry") {
    return {
      mainView: el.registryMainView,
      dbView: el.registryDbView,
      tabs: el.registryDbTabs,
      container: el.registryDb,
      dbBtn: el.registryDbBtn,
      errorEl: el.registryError,
    };
  }
  return {
    mainView: el.relayMainView,
    dbView: el.relayDbView,
    tabs: el.relayDbTabs,
    container: el.relayDb,
    dbBtn: el.relayDbBtn,
    errorEl: el.relayError,
  };
}

function isDatabaseView() {
  return state.view === "database";
}

function applyViewMode() {
  for (const panelSource of ["registry", "relay"]) {
    const showDb = state.panel === panelSource && state.view === "database";
    const { mainView, dbView, dbBtn } = panelDbElements(panelSource);
    mainView?.classList.toggle("hidden", showDb);
    dbView?.classList.toggle("hidden", !showDb);
    if (dbBtn) {
      dbBtn.setAttribute("aria-pressed", showDb ? "true" : "false");
    }
  }
  observeActiveRefreshBtn();
}

function openDatabaseView(panelSource) {
  state.panel = panelSource;
  state.view = "database";
  el.navItems.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.panel === panelSource);
  });
  el.panels.forEach((panel) => {
    panel.classList.toggle("active", panel.id === `panel-${panelSource}`);
  });
  applyViewMode();
  void loadDatabaseView(panelSource);
}

function closeDatabaseView() {
  state.view = "main";
  applyViewMode();
}

function statusClass(healthStatus) {
  return `status-${healthStatus}`;
}

function statusLabel(healthStatus) {
  const labels = {
    online: "在线",
    stale: "心跳过期",
    never_seen: "未上报",
    disabled: "已禁用",
  };
  return labels[healthStatus] || healthStatus;
}

function relayInitials(relayId) {
  const id = String(relayId || "").trim();
  if (!id) return "R";
  const slug = id.replace(/^relay[-_]/i, "");
  const source = slug || id;
  const first = source[0].toUpperCase();
  const last = source[source.length - 1].toUpperCase();
  return `R${first}${last}`;
}

function isPendingRemoval(relayId) {
  return state.pendingRemovals.has(relayId);
}

function renderRelayGrid(relays) {
  state.relays = relays;
  const displayRelays = relays.length
    ? relays
    : state.pendingRemovals.size
      ? []
      : [];

  if (!displayRelays.length && !state.pendingRemovals.size) {
    el.relayGrid.innerHTML =
      '<div class="empty-state">Allowlist 中暂无 Relay。Relay 启动后会提交注册申请，请点击右上角信封审批。</div>';
    return;
  }

  if (!displayRelays.length && state.pendingRemovals.size) {
    el.relayGrid.innerHTML =
      '<div class="empty-state">Allowlist 中暂无其他 Relay；移除中的项请在刷新前通过右键撤销。</div>';
    return;
  }

  el.relayGrid.innerHTML = displayRelays
    .map((relay) => {
      const pending = isPendingRemoval(relay.relayId);
      const rate = relay.storageRate ?? 0;
      const stored = relay.storedBlocks ?? 0;
      const max = relay.maxBlocks ?? 0;
      const pct = max > 0 ? Math.min(100, Math.round((stored / max) * 100)) : 0;
      const statusRow = pending
        ? '<div class="relay-removal-hint">移除中 · 刷新以更新状态</div>'
        : `<span class="status-badge ${statusClass(relay.healthStatus)}">${escapeHtml(statusLabel(relay.healthStatus))}</span>`;
      return `
        <article class="relay-card${pending ? " pending-removal" : ""}" data-relay-id="${escapeHtml(relay.relayId)}">
          <div class="thumb">${escapeHtml(relayInitials(relay.relayId))}</div>
          <div class="relay-id">${escapeHtml(relay.relayId)}</div>
          <div class="relay-url">${escapeHtml(relay.relayBaseUrl || "—")}</div>
          ${statusRow}
          <div class="storage-bar" title="${stored} / ${max} blocks"><span style="width:${pct}%"></span></div>
        </article>`;
    })
    .join("");

  el.relayGrid.querySelectorAll(".relay-card").forEach((card) => {
    card.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      openContextMenu(event.clientX, event.clientY, card.dataset.relayId);
    });
  });
}

const DB_TABLE_PRIMARY_KEYS = {
  registry: {
    registry_allowlist: ["relay_id"],
    relay_registration_requests: ["install_id"],
    relay_states: ["relay_id"],
    token_relay_placements: ["token", "relay_id"],
    relay_registry_keys: ["relay_id", "key_id"],
    relay_block_auth_keys: ["relay_id", "key_id"],
  },
  relay: {
    blocks: ["token"],
  },
};

function resolveDbPrimaryKey(panelSource, tableName, table) {
  if (Array.isArray(table.primaryKey) && table.primaryKey.length) {
    return table.primaryKey;
  }
  const fallback = DB_TABLE_PRIMARY_KEYS[panelSource]?.[tableName];
  return fallback || [];
}

function buildDbRowKeys(row, primaryKey) {
  if (!Array.isArray(primaryKey) || !primaryKey.length) {
    return null;
  }
  const keys = {};
  for (const column of primaryKey) {
    const value = row[column];
    if (value === undefined || value === null || value === "") {
      return null;
    }
    keys[column] = value;
  }
  return keys;
}

function encodeDbRowPayload(value) {
  return encodeURIComponent(JSON.stringify(value));
}

function bindDbRowContextMenu(container) {
  container.querySelectorAll(".db-row").forEach((rowEl) => {
    rowEl.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      openDbContextMenu(event.clientX, event.clientY, {
        panel: rowEl.dataset.panel,
        table: rowEl.dataset.table,
        keys: JSON.parse(decodeURIComponent(rowEl.dataset.keys)),
      });
    });
  });
}

function renderDbTableContent(container, table, tableName, panelSource) {
  const rows = table.rows || [];
  const columns = rows.length ? Object.keys(rows[0]) : [];
  const primaryKey = resolveDbPrimaryKey(panelSource, tableName, table);
  const head = columns
    .map(
      (col) =>
        `<th><span class="db-cell db-cell--header" data-full-text="${escapeHtml(col)}">${escapeHtml(col)}</span></th>`,
    )
    .join("");
  const body = rows
    .map((row) => {
      const keys = buildDbRowKeys(row, primaryKey);
      const deletable = keys !== null;
      const rowAttrs = deletable
        ? ` class="db-row" data-panel="${escapeHtml(panelSource)}" data-table="${escapeHtml(tableName)}" data-keys="${encodeDbRowPayload(keys)}"`
        : "";
      return `<tr${rowAttrs}>${columns
        .map((col) => {
          const text = formatCell(row[col]);
          return `<td><span class="db-cell db-cell--value" data-full-text="${escapeHtml(text)}">${escapeHtml(text)}</span></td>`;
        })
        .join("")}</tr>`;
    })
    .join("");
  const truncated = table.truncated ? "（已截断）" : "";
  container.innerHTML = `
    <section class="db-table-block">
      <div class="db-meta">共 ${table.totalRows ?? rows.length} 行 ${truncated}${primaryKey.length ? " · 右键行可删除" : ""}</div>
      <div class="table-wrap">
        <table>
          <thead><tr>${head}</tr></thead>
          <tbody>${body || `<tr><td colspan="${columns.length || 1}">空</td></tr>`}</tbody>
        </table>
      </div>
    </section>`;
  bindDbRowContextMenu(container);
  bindDbCellTooltips(container);
}

function selectDbTab(panelSource, tableName) {
  const cached = state.dbCache[panelSource];
  if (!cached?.tables?.[tableName]) {
    return;
  }
  state.dbActiveTab[panelSource] = tableName;
  const { tabs, container } = panelDbElements(panelSource);
  tabs?.querySelectorAll(".db-tab").forEach((tab) => {
    const active = tab.dataset.table === tableName;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", active ? "true" : "false");
  });
  renderDbTableContent(container, cached.tables[tableName], tableName, panelSource);
}

function renderDbViewer(tabsContainer, container, dbPayload, panelSource, activeTableName) {
  const tables = dbPayload?.tables || {};
  const names = Object.keys(tables).sort();
  if (!names.length) {
    if (tabsContainer) tabsContainer.innerHTML = "";
    container.innerHTML = '<div class="empty-state">无表数据</div>';
    return;
  }

  let active = activeTableName;
  if (!active || !names.includes(active)) {
    active = names[0];
  }
  state.dbActiveTab[panelSource] = active;

  if (tabsContainer) {
    tabsContainer.innerHTML = names
      .map(
        (name) =>
          `<button type="button" class="db-tab${name === active ? " active" : ""}" role="tab" aria-selected="${name === active ? "true" : "false"}" data-table="${escapeHtml(name)}">${escapeHtml(name)}</button>`,
      )
      .join("");
    tabsContainer.querySelectorAll(".db-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        selectDbTab(panelSource, tab.dataset.table);
      });
    });
  }

  renderDbTableContent(container, tables[active], active, panelSource);
}

async function loadDatabaseView(panelSource) {
  const { tabs, container, errorEl } = panelDbElements(panelSource);
  clearError(errorEl);
  try {
    const path = panelSource === "registry" ? "/api/registry/db" : "/api/relay/db";
    const db = await api(path);
    state.dbCache[panelSource] = db;
    renderDbViewer(tabs, container, db, panelSource, state.dbActiveTab[panelSource]);
    if (panelSource === "registry") {
      void loadRegistrationBadge();
    }
  } catch (error) {
    showError(errorEl, error.message);
  }
}

async function refreshDbViewer() {
  await loadDatabaseView(state.panel);
}

function formatRelayId(value) {
  if (value === undefined || value === null || value === "") {
    return "未指派";
  }
  return String(value);
}

function abbreviateInstallId(value) {
  const id = String(value || "").trim();
  if (!id) return "—";
  if (id.length <= 16) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

function formatRemainingBlocks(stored, max) {
  if (max == null || max === undefined || Number.isNaN(Number(max))) {
    return "—";
  }
  const storedCount = Number(stored) || 0;
  const maxCount = Number(max) || 0;
  return String(Math.max(0, maxCount - storedCount));
}

function assignmentStatusMeta(status) {
  if (status === "assigned") {
    return { label: "已注册", badgeClass: "status-online" };
  }
  if (status === "unassigned") {
    return { label: "未注册", badgeClass: "status-never_seen" };
  }
  return { label: "未知", badgeClass: "status-disabled" };
}

function serviceStatusMeta(health) {
  if (health?.status === "ok") {
    return { label: "正常", badgeClass: "status-online" };
  }
  return { label: "异常", badgeClass: "status-stale" };
}

function readyStatusMeta(ready) {
  if (ready) {
    return { label: "就绪", badgeClass: "status-online" };
  }
  return { label: "未就绪", badgeClass: "status-stale" };
}

function normalizeServiceUrl(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "";
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return String(url).trim().replace(/\/+$/, "");
  }
}

function registryUrlPointsLocal(relayRegistryUrl, localRegistryUrl) {
  const relayUrl = normalizeServiceUrl(relayRegistryUrl);
  const localUrl = normalizeServiceUrl(localRegistryUrl);
  return Boolean(relayUrl && localUrl && relayUrl === localUrl);
}

function registryConnectivityMeta(overview, context = {}) {
  const { registryLocalRunning, registryPointsLocal } = context;
  const heartbeatSec = overview.heartbeatIntervalSeconds;
  const intervalHint =
    heartbeatSec != null ? `心跳间隔 ${heartbeatSec} 秒。` : "默认心跳间隔 30 秒。";
  const localRegistryStopped =
    registryPointsLocal && registryLocalRunning === false;

  if (localRegistryStopped) {
    if (overview.registryContactOk === true) {
      return {
        label: "可能过期",
        badgeClass: "status-stale",
        helpText: `侧边栏 Registry 本地服务已关闭。Relay 仍显示上次联系成功；约 ${heartbeatSec ?? 30} 秒内下次心跳失败后将更新为不可达。${intervalHint}`,
      };
    }
    if (overview.registryContactOk === false) {
      const error = overview.registryContactError || "联系失败";
      const at = overview.registryContactAt;
      return {
        label: "不可达",
        badgeClass: "status-stale",
        helpText: `本地 Registry 已关闭，Relay 无法联系 Registry。${at ? `上次尝试：${at}。` : ""}${error} ${intervalHint}`,
      };
    }
    return {
      label: "本地未运行",
      badgeClass: "status-stale",
      helpText: `Relay 配置的 Registry 指向本地实例，但侧边栏 Registry 服务未运行。启动 Registry 后 Relay 将自动重连。${intervalHint}`,
    };
  }

  if (!Object.prototype.hasOwnProperty.call(overview, "registryContactOk")) {
    return {
      label: "未上报",
      badgeClass: "status-never_seen",
      helpText: `当前 Relay 进程尚未上报连通状态，请在侧边栏重启 Relay 后再查看。${intervalHint}`,
    };
  }

  const ok = overview.registryContactOk;
  if (ok === true) {
    const at = overview.registryContactAt;
    return {
      label: "正常",
      badgeClass: "status-online",
      helpText: at
        ? `最近一次 Registry 同步或心跳成功（${at}）。${intervalHint}`
        : `最近一次 Registry 同步或心跳成功。${intervalHint}`,
    };
  }
  if (ok === false) {
    const error = overview.registryContactError || "联系失败";
    const at = overview.registryContactAt;
    return {
      label: "不可达",
      badgeClass: "status-stale",
      helpText: at
        ? `上次尝试：${at}。${error} ${intervalHint}`
        : `${error} ${intervalHint}`,
    };
  }
  return {
    label: "未知",
    badgeClass: "status-never_seen",
    helpText: `尚未与 Registry 联系，启动后会在首次同步时更新。${intervalHint}`,
  };
}

const RELAY_ID_HELP =
  "注册通过审批后，由 Registry 节点分配的标识序列。在该 Registry 节点中唯一。";
const INSTALL_ID_HELP =
  "首次启动时本地生成的 UUID，用于在注册的申请与审批中标识注册方。自生成后保存在本地文件中，通常不会更改。";
const PUBLIC_URL_HELP =
  "对外服务根地址。客户端与 Registry 通过此 URL 拉取/上传块（{地址}/{token}）。须为外部实际可达地址，而非本机监听地址；修改后需重启 Relay。";
const EFFECTIVE_STORAGE_CAP_HELP =
  "Registry 分配上传路由时使用的最长可承诺 TTL（块 TTL 减 60 秒时钟余量）。sweep 仅在块到期后才会删除，不会因此缩短该值。";
const CLOCK_SKEW_SECONDS = 60;

function relayEffectiveCapSeconds(relay) {
  const blockMaxAge = relay?.blockMaxAgeSeconds;
  if (blockMaxAge == null || Number.isNaN(Number(blockMaxAge))) {
    return null;
  }
  return Math.max(1, Number(blockMaxAge) - CLOCK_SKEW_SECONDS);
}

function formatEffectiveStorageCap(relay) {
  const seconds = relayEffectiveCapSeconds(relay);
  if (seconds == null) return "—";
  return String(seconds);
}

function renderStatCardHelpButton(helpText, label) {
  return `
    <button
      type="button"
      class="stat-card-help-btn"
      data-help-text="${escapeHtml(helpText)}"
      aria-label="${escapeHtml(label)} 说明"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M9.5 9a2.5 2.5 0 0 1 4.6 1.2c0 1.6-2.1 2.1-2.1 3.3" />
        <circle cx="12" cy="16.75" r="0.85" fill="currentColor" stroke="none" />
      </svg>
    </button>`;
}

function renderStatClusterConfigureButton(action, label) {
  return `
    <button
      type="button"
      class="stat-cluster-configure-btn icon-btn"
      data-configure-action="${escapeHtml(action)}"
      aria-label="配置 ${escapeHtml(label)}"
      title="配置 ${escapeHtml(label)}"
    >
      <svg class="stat-cluster-configure-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
      </svg>
    </button>`;
}

function renderRelayStatCard(label, value, options = {}) {
  const text = String(value ?? "—");
  const classes = ["stat-card"];
  if (options.helpText) classes.push("stat-card--has-help");
  if (options.kind === "badge") {
    classes.push("stat-card--status");
  } else if (options.kind === "url") {
    classes.push("stat-card--wide");
  } else if (options.kind === "abbrev") {
    classes.push("stat-card--medium");
  } else if (options.numeric) {
    classes.push("stat-card--numeric");
  }
  const helpBtn = options.helpText ? renderStatCardHelpButton(options.helpText, label) : "";
  let valueHtml = "";

  if (options.kind === "badge") {
    const badgeClass = options.badgeClass || "status-never_seen";
    valueHtml = `
      <div class="value stat-card-badges">
        <span class="status-badge ${badgeClass}">${escapeHtml(text)}</span>
      </div>`;
  } else if (options.kind === "url" && text !== "—") {
    valueHtml = `
      <div class="value stat-value-url" data-full-url="${escapeHtml(text)}" tabindex="0">${escapeHtml(text)}</div>`;
  } else if (options.kind === "abbrev" && options.fullText) {
    valueHtml = `
      <div class="value stat-value-url" data-full-url="${escapeHtml(options.fullText)}" tabindex="0">${escapeHtml(text)}</div>`;
  } else {
    valueHtml = `<div class="value">${escapeHtml(text)}</div>`;
  }

  return `
    <div class="${classes.join(" ")}">
      ${helpBtn}
      <div class="label">${escapeHtml(label)}</div>
      ${valueHtml}
    </div>`;
}

function renderRelayStatCards(cards) {
  return cards.map((entry) => renderRelayStatCard(...entry)).join("");
}

function parseServiceUrl(url) {
  const text = String(url ?? "").trim();
  if (!text || text === "—") return null;
  try {
    const parsed = new URL(text);
    const path =
      parsed.pathname && parsed.pathname !== "/"
        ? `${parsed.pathname}${parsed.search}${parsed.hash}`
        : "";
    return {
      full: text,
      scheme: parsed.protocol.replace(/:$/, ""),
      hostPort: parsed.host,
      path,
    };
  } catch {
    return { full: text, scheme: "", hostPort: text, path: "" };
  }
}

function renderUrlClusterValue(url) {
  const parts = parseServiceUrl(url);
  if (!parts) {
    return `<span class="stat-cluster-value">—</span>`;
  }
  const schemeHtml = parts.scheme
    ? `<span class="stat-url-scheme">${escapeHtml(parts.scheme)}</span>`
    : "";
  const pathHtml = parts.path ? escapeHtml(parts.path) : "";
  return `
    <a
      class="stat-url-value stat-value-url"
      href="${escapeHtml(parts.full)}"
      target="_blank"
      rel="noopener noreferrer"
      data-full-url="${escapeHtml(parts.full)}"
      tabindex="0"
    >${schemeHtml}<span class="stat-url-host">${escapeHtml(parts.hostPort)}${pathHtml}</span></a>`;
}

function renderOverviewCluster(title, rows, options = {}) {
  const clusterClass =
    options.variant === "url" ? " stat-card stat-card--cluster stat-card--url-cluster" : " stat-card stat-card--cluster";
  const rowsHtml = rows
    .map((row) => {
      const helpBtn = row.helpText ? renderStatCardHelpButton(row.helpText, row.label) : "";
      const configureBtn = row.configureAction
        ? renderStatClusterConfigureButton(row.configureAction, row.label)
        : "";
      const hasHelpSlot = Boolean(row.helpText) || row.kind === "badge";
      let valueHtml = "";
      let rowClass = "stat-cluster-row";
      if (row.kind === "badge") {
        const badgeClass = row.badgeClass || "status-never_seen";
        valueHtml = `<span class="status-badge ${badgeClass}">${escapeHtml(String(row.value ?? "—"))}</span>`;
        rowClass = "stat-cluster-row stat-cluster-row--status";
      } else if (row.kind === "url") {
        valueHtml = renderUrlClusterValue(row.value);
        rowClass = "stat-cluster-row stat-cluster-row--url";
        if (row.helpText || row.configureAction) {
          const headActionsHtml = helpBtn
            ? `<div class="stat-cluster-url-actions">${helpBtn}</div>`
            : "";
          const urlLineHtml = row.configureAction
            ? `
        <div class="stat-cluster-url-line">
          <div class="stat-cluster-row-value">${valueHtml}</div>
          ${configureBtn}
        </div>`
            : `<div class="stat-cluster-row-value">${valueHtml}</div>`;
          return `
      <div class="${rowClass}">
        <div class="stat-cluster-url-head">
          <span class="stat-cluster-label">${escapeHtml(row.label)}</span>
          ${headActionsHtml}
        </div>
        ${urlLineHtml}
      </div>`;
        }
      } else if (row.kind === "abbrev" && row.fullText) {
        valueHtml = `<span class="stat-cluster-value stat-value-url" data-full-url="${escapeHtml(row.fullText)}" tabindex="0">${escapeHtml(String(row.value ?? "—"))}</span>`;
      } else {
        valueHtml = `<span class="stat-cluster-value">${escapeHtml(String(row.value ?? "—"))}</span>`;
      }
      if (row.kind !== "url" && row.kind !== "badge") {
        rowClass = hasHelpSlot ? "stat-cluster-row stat-cluster-row--status" : "stat-cluster-row";
      } else if (row.kind === "badge") {
        rowClass = "stat-cluster-row stat-cluster-row--status";
      }
      const helpSlot = hasHelpSlot
        ? `<div class="stat-card-help-slot">${helpBtn}</div>`
        : "";
      return `
      <div class="${rowClass}">
        <span class="stat-cluster-label">${escapeHtml(row.label)}</span>
        <div class="stat-cluster-row-value">${valueHtml}</div>
        ${helpSlot}
      </div>`;
    })
    .join("");
  return `
    <div class="${clusterClass.trim()}">
      <div class="stat-cluster-title">${escapeHtml(title)}</div>
      <div class="stat-cluster-rows">${rowsHtml}</div>
    </div>`;
}

function renderStatCluster(title, rows) {
  return renderOverviewCluster(
    title,
    rows.map(([label, value]) => ({ label, value })),
  );
}

function renderRelayOverviewGroup(title, cardsHtml, extraClass = "", footerHtml = "") {
  return `
    <section class="relay-overview-group">
      <h2 class="relay-overview-group-title">${escapeHtml(title)}</h2>
      <div class="overview-cards${extraClass ? ` ${extraClass}` : ""}">${cardsHtml}</div>
      ${footerHtml}
    </section>`;
}

function formatStoragePercent(rate) {
  if (rate == null || Number.isNaN(rate)) return "—";
  const pct = Math.min(1, Math.max(0, rate)) * 100;
  if (pct > 0 && pct < 0.1) return pct.toFixed(2);
  if (pct < 10) return pct.toFixed(1);
  return String(Math.round(pct));
}

function renderStoragePieCard(overview) {
  const rate = overview.storageRate;
  const percentLabel = formatStoragePercent(rate);

  if (rate == null || Number.isNaN(rate)) {
    return `
      <div class="stat-card stat-card--storage">
        <div class="label">存储率</div>
        <div class="storage-pie storage-pie--empty" aria-hidden="true">
          <span class="storage-pie-label">—</span>
        </div>
      </div>`;
  }

  const pct = Math.min(1, Math.max(0, rate));
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const filled = circumference * pct;

  return `
    <div class="stat-card stat-card--storage">
      <div class="label">存储率</div>
      <div class="storage-pie" role="img" aria-label="存储率 ${percentLabel}%">
        <svg viewBox="0 0 88 88" aria-hidden="true">
          <circle class="storage-pie-track" cx="44" cy="44" r="${radius}" />
          <circle
            class="storage-pie-fill"
            cx="44"
            cy="44"
            r="${radius}"
            stroke-dasharray="${filled} ${circumference - filled}"
          />
        </svg>
        <span class="storage-pie-label">${escapeHtml(percentLabel)}<span class="storage-pie-unit">%</span></span>
      </div>
    </div>`;
}

function renderRelayOverview(relay, registryUrl, connectivityContext = {}) {
  state.lastRelayOverview = { relay, registryUrl, connectivityContext };
  const assignment = assignmentStatusMeta(relay.assignmentStatus);
  const service = serviceStatusMeta(relay);
  const dbReady = readyStatusMeta(Boolean(relay?.dbReady));
  const registryKey = readyStatusMeta(Boolean(relay?.registryApiKeyReady));
  const blockAuthKey = readyStatusMeta(Boolean(relay?.blockAuthKeyReady));
  const installId = relay.installId || "";
  const installIdShort = abbreviateInstallId(installId);

  const identityCards =
    renderOverviewCluster("标识与注册", [
      {
        label: "Relay ID",
        value: formatRelayId(relay.relayId),
        helpText: RELAY_ID_HELP,
      },
      {
        label: "Install ID",
        value: installIdShort,
        kind: installId ? "abbrev" : undefined,
        fullText: installId || undefined,
        helpText: INSTALL_ID_HELP,
      },
      {
        label: "注册状态",
        value: assignment.label,
        kind: "badge",
        badgeClass: assignment.badgeClass,
      },
    ]) +
    renderOverviewCluster(
      "服务地址",
      [
        {
          label: "Public URL",
          value: relay.publicBaseUrl,
          kind: "url",
          helpText: PUBLIC_URL_HELP,
          configureAction: "public-url",
        },
        { label: "Registry URL", value: registryUrl || "—", kind: "url" },
      ],
      { variant: "url" },
    );

  const storageCards =
    renderStatCluster("存储容量", [
      ["已存块", relay.storedBlocks ?? "—"],
      ["剩余容量", formatRemainingBlocks(relay.storedBlocks, relay.maxBlocks)],
      ["容量上限", relay.maxBlocks ?? "—"],
    ]) +
    renderStatCluster("生命周期", [
      ["块 TTL (秒)", relay.blockMaxAgeSeconds ?? "—"],
      ["清理间隔 (秒)", relay.blockSweepIntervalSeconds ?? "—"],
    ]) +
    renderOverviewCluster("Registry 调度", [
      {
        label: "有效存储能力 (秒)",
        value: formatEffectiveStorageCap(relay),
        helpText: EFFECTIVE_STORAGE_CAP_HELP,
      },
    ]) +
    renderStoragePieCard(relay);

  const registryConnectivity = registryConnectivityMeta(relay, connectivityContext);

  const runtimeCards =
    renderOverviewCluster("服务与连通", [
      {
        label: "本地服务",
        value: service.label,
        kind: "badge",
        badgeClass: service.badgeClass,
      },
      {
        label: "Registry 连通",
        value: registryConnectivity.label,
        kind: "badge",
        badgeClass: registryConnectivity.badgeClass,
        helpText: registryConnectivity.helpText,
      },
    ]) +
    renderOverviewCluster("数据与密钥", [
      {
        label: "数据库",
        value: dbReady.label,
        kind: "badge",
        badgeClass: dbReady.badgeClass,
      },
      {
        label: "Registry Key",
        value: registryKey.label,
        kind: "badge",
        badgeClass: registryKey.badgeClass,
      },
      {
        label: "BlockAuth Key",
        value: blockAuthKey.label,
        kind: "badge",
        badgeClass: blockAuthKey.badgeClass,
      },
    ]);

  el.relayOverview.innerHTML =
    renderRelayOverviewGroup("身份与注册", identityCards, "overview-cards--identity") +
    renderRelayOverviewGroup("存储与生命周期", storageCards, "overview-cards--storage") +
    renderRelayOverviewGroup("运行与密钥", runtimeCards, "overview-cards--status");
  bindUrlTooltips();
  bindStatCardHelpTooltips();
  bindOverviewConfigureButtons();
}

function bindOverviewConfigureButtons(root = el.relayOverview) {
  if (!root) return;
  for (const button of root.querySelectorAll("[data-configure-action]")) {
    button.addEventListener("click", () => {
      const action = button.dataset.configureAction;
      if (action === "public-url") {
        void openRelayPublicUrlDialog();
      }
    });
  }
}

function bindStatCardHelpTooltips(root = el.relayOverview) {
  if (!el.urlTooltipFloat || !root) return;
  for (const button of root.querySelectorAll(".stat-card-help-btn[data-help-text]")) {
    button.addEventListener("mouseenter", () => showFloatTooltip(button));
    button.addEventListener("mouseleave", scheduleTooltipHide);
    button.addEventListener("focus", () => showFloatTooltip(button));
    button.addEventListener("blur", hideUrlTooltip);
  }
}

function cancelTooltipHide() {
  if (state.tooltipHideTimer) {
    clearTimeout(state.tooltipHideTimer);
    state.tooltipHideTimer = null;
  }
}

function scheduleTooltipHide() {
  cancelTooltipHide();
  state.tooltipHideTimer = setTimeout(() => {
    if (!state.tooltipOverFloat) {
      hideUrlTooltip();
    }
  }, TOOLTIP_HIDE_DELAY_MS);
}

function showFloatTooltip(anchor, text) {
  const content =
    text ?? anchor.dataset.helpText ?? anchor.dataset.fullText ?? anchor.dataset.fullUrl;
  if (!content || !el.urlTooltipFloat) return;
  cancelTooltipHide();
  const copyable = Boolean(anchor.dataset.fullUrl || anchor.dataset.fullText);
  el.urlTooltipFloat.classList.toggle("url-tooltip-float--copyable", copyable);
  el.urlTooltipFloat.textContent = content;
  el.urlTooltipFloat.classList.remove("hidden");
  positionUrlTooltip(anchor, el.urlTooltipFloat);
}

function showUrlTooltip(anchor) {
  showFloatTooltip(anchor, anchor.dataset.fullUrl);
}

function hideUrlTooltip() {
  cancelTooltipHide();
  state.tooltipOverFloat = false;
  el.urlTooltipFloat?.classList.add("hidden");
}

function initUrlTooltipFloat() {
  if (!el.urlTooltipFloat) return;
  el.urlTooltipFloat.addEventListener("mouseenter", () => {
    state.tooltipOverFloat = true;
    cancelTooltipHide();
  });
  el.urlTooltipFloat.addEventListener("mouseleave", () => {
    state.tooltipOverFloat = false;
    scheduleTooltipHide();
  });
}

function truncateMiddleByLength(text, visibleLen) {
  if (visibleLen >= text.length) return text;
  if (visibleLen <= 1) return "…";
  const keep = visibleLen - 1;
  const front = Math.ceil(keep / 2);
  const back = Math.floor(keep / 2);
  return `${text.slice(0, front)}…${text.slice(text.length - back)}`;
}

function applyDbHeaderEllipsis(cell) {
  const fullText = cell.dataset.fullText || "";
  cell.textContent = fullText;
  if (!fullText || cell.scrollWidth <= cell.clientWidth) {
    return;
  }

  let lo = 1;
  let hi = fullText.length;
  let best = "…";
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const candidate = truncateMiddleByLength(fullText, mid);
    cell.textContent = candidate;
    if (cell.scrollWidth <= cell.clientWidth) {
      best = candidate;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  cell.textContent = best;
}

function isDbCellTruncated(cell) {
  const fullText = cell.dataset.fullText || "";
  if (!fullText) return false;
  if (cell.classList.contains("db-cell--header")) {
    return cell.textContent !== fullText;
  }
  return cell.scrollWidth > cell.clientWidth;
}

function bindDbCellTooltips(container) {
  if (!el.urlTooltipFloat) return;

  const bindCells = () => {
    const cells = container.querySelectorAll(".db-cell[data-full-text]");
    for (const cell of cells) {
      if (cell.classList.contains("db-cell--header")) {
        applyDbHeaderEllipsis(cell);
      }
      cell.dataset.truncated = isDbCellTruncated(cell) ? "true" : "false";
      if (cell.dataset.truncated === "true") {
        cell.tabIndex = 0;
      } else {
        cell.removeAttribute("tabindex");
      }

      cell.addEventListener("mouseenter", () => {
        if (cell.dataset.truncated === "true") {
          showFloatTooltip(cell);
        }
      });
      cell.addEventListener("mouseleave", scheduleTooltipHide);
      cell.addEventListener("contextmenu", hideUrlTooltip);
      cell.addEventListener("focus", () => {
        if (cell.dataset.truncated === "true") {
          showFloatTooltip(cell);
        }
      });
      cell.addEventListener("blur", hideUrlTooltip);
    }

    container.querySelector(".table-wrap")?.addEventListener("scroll", hideUrlTooltip, {
      passive: true,
    });
  };

  requestAnimationFrame(bindCells);
}

const VIEWPORT_MARGIN = 8;
const TOOLTIP_MAX_WIDTH = 640;
const TOOLTIP_MIN_WIDTH = 260;

function positionInViewport(element, x, y) {
  element.style.left = `${x}px`;
  element.style.top = `${y}px`;

  const rect = element.getBoundingClientRect();
  let left = x;
  let top = y;

  if (rect.right > window.innerWidth - VIEWPORT_MARGIN) {
    left = x - rect.width;
  }
  if (rect.bottom > window.innerHeight - VIEWPORT_MARGIN) {
    top = y - rect.height;
  }

  left = Math.max(
    VIEWPORT_MARGIN,
    Math.min(left, window.innerWidth - VIEWPORT_MARGIN - rect.width),
  );
  top = Math.max(
    VIEWPORT_MARGIN,
    Math.min(top, window.innerHeight - VIEWPORT_MARGIN - rect.height),
  );

  element.style.left = `${left}px`;
  element.style.top = `${top}px`;
}

function positionUrlTooltip(anchor, floater) {
  const margin = VIEWPORT_MARGIN;
  const maxWidth = Math.min(window.innerWidth - margin * 2, TOOLTIP_MAX_WIDTH);
  const minWidth = Math.min(TOOLTIP_MIN_WIDTH, maxWidth);

  floater.style.maxWidth = `${maxWidth}px`;
  floater.style.minWidth = `${minWidth}px`;
  floater.style.width = "auto";

  // Measure with the full width budget first so right-edge anchors do not pre-squeeze the bubble.
  floater.style.left = `${margin}px`;
  floater.style.top = "-9999px";

  let width = Math.min(
    Math.max(floater.getBoundingClientRect().width, minWidth),
    maxWidth,
  );
  floater.style.width = `${width}px`;

  const anchorRect = anchor.getBoundingClientRect();
  let left = anchorRect.left;
  let top = anchorRect.bottom + 6;

  if (left + width > window.innerWidth - margin) {
    left = window.innerWidth - margin - width;
  }
  left = Math.max(margin, left);

  floater.style.left = `${left}px`;
  floater.style.top = `${top}px`;

  let placed = floater.getBoundingClientRect();
  if (placed.bottom > window.innerHeight - margin) {
    top = Math.max(margin, anchorRect.top - placed.height - 6);
    floater.style.top = `${top}px`;
    placed = floater.getBoundingClientRect();
  }
  if (placed.top < margin) {
    floater.style.top = `${margin}px`;
  }
}

function bindUrlTooltips() {
  if (!el.urlTooltipFloat) return;
  for (const node of el.relayOverview.querySelectorAll(".stat-value-url[data-full-url]")) {
    node.addEventListener("mouseenter", () => showUrlTooltip(node));
    node.addEventListener("mouseleave", scheduleTooltipHide);
    node.addEventListener("focus", () => showUrlTooltip(node));
    node.addEventListener("blur", hideUrlTooltip);
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatCell(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function openContextMenu(x, y, relayId) {
  hideUrlTooltip();
  closeDbContextMenu();
  state.contextRelay = state.relays.find((item) => item.relayId === relayId) || null;
  if (!state.contextRelay) return;

  const pending = isPendingRemoval(relayId);
  const manageBtn = el.contextMenu.querySelector('[data-action="manage"]');
  const removeBtn = el.contextMenu.querySelector('[data-action="remove"]');
  const undoBtn = el.contextMenu.querySelector('[data-action="undo"]');
  manageBtn.classList.toggle("hidden", pending);
  removeBtn.classList.toggle("hidden", pending);
  undoBtn.classList.toggle("hidden", !pending);

  el.contextMenu.classList.remove("hidden");
  positionInViewport(el.contextMenu, x, y);
}

function closeContextMenu() {
  el.contextMenu.classList.add("hidden");
  state.contextRelay = null;
}

function openDbContextMenu(x, y, rowContext) {
  hideUrlTooltip();
  closeContextMenu();
  closeServiceContextMenu();
  state.contextDbRow = rowContext;
  el.dbContextMenu.classList.remove("hidden");
  positionInViewport(el.dbContextMenu, x, y);
}

function closeDbContextMenu() {
  el.dbContextMenu.classList.add("hidden");
  state.contextDbRow = null;
}

function formatDbRowLabel(keys) {
  return Object.entries(keys)
    .map(([column, value]) => `${column}=${value}`)
    .join(", ");
}

async function deleteDbRow(rowContext) {
  const apiPath =
    rowContext.panel === "registry"
      ? "/api/registry/db/rows/delete"
      : "/api/relay/db/rows/delete";
  const errorEl = rowContext.panel === "registry" ? el.registryError : el.relayError;
  clearError(errorEl);
  try {
    await api(apiPath, {
      method: "POST",
      body: JSON.stringify({
        table: rowContext.table,
        keys: rowContext.keys,
      }),
    });
    await refreshDbViewer();
  } catch (error) {
    showError(errorEl, error.message);
  }
}

function openServiceContextMenu(x, y, serviceName, action) {
  hideUrlTooltip();
  closeDbContextMenu();
  state.contextService = serviceName;
  const when = action === "stop" ? "running" : "stopped";
  el.serviceContextMenu.querySelectorAll("button[data-menu-when]").forEach((button) => {
    button.classList.toggle("hidden", button.dataset.menuWhen !== when);
  });
  el.serviceContextMenu.classList.remove("hidden");
  positionInViewport(el.serviceContextMenu, x, y);
}

function closeServiceContextMenu() {
  el.serviceContextMenu.classList.add("hidden");
  state.contextService = null;
}

function openManageDialog(relay) {
  el.manageRelayTitle.textContent = `管理 ${relay.relayId}`;
  el.manageRelayForm.relayId.value = relay.relayId;
  el.manageRelayForm.relayBaseUrl.value = relay.relayBaseUrl || "";
  el.manageRelayForm.enabled.checked = relay.enabled !== false;
  el.manageRelayDialog.showModal();
}

function formatTimestamp(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function updateRegistrationBadge(count) {
  const total = Number(count) || 0;
  el.registrationInboxBadge.textContent = total > 99 ? "99+" : String(total);
  el.registrationInboxBadge.classList.toggle("hidden", total === 0);
}

async function loadRegistrationBadge() {
  try {
    const data = await api("/api/registry/registration-requests");
    updateRegistrationBadge(data.pendingCount ?? data.requests?.length ?? 0);
  } catch {
    /* badge is best-effort */
  }
}

function renderRegistrationInbox(requests) {
  if (!requests.length) {
    el.registrationInboxList.innerHTML =
      '<div class="empty-state">暂无待处理注册申请。</div>';
    return;
  }

  el.registrationInboxList.innerHTML = requests
    .map((request) => {
      const publicKeyHint = request.hasPublicKey
        ? '<span class="registration-inbox-tag">已提交公钥</span>'
        : "";
      return `
        <article class="registration-inbox-item" data-install-id="${escapeHtml(request.installId)}">
          <div class="registration-inbox-main">
            <div class="registration-inbox-id">${escapeHtml(request.installId)}</div>
            <div class="registration-inbox-url">${escapeHtml(request.relayBaseUrl || "—")}</div>
            <div class="registration-inbox-meta">
              <span>申请 ${escapeHtml(formatTimestamp(request.requestedAt))}</span>
              <span>最近 ${escapeHtml(formatTimestamp(request.lastSeenAt))}</span>
              ${publicKeyHint}
            </div>
          </div>
          <div class="registration-inbox-actions">
            <button type="button" class="primary-btn" data-action="approve">同意并指派</button>
            <button type="button" class="ghost-btn" data-action="ignore">忽视</button>
          </div>
        </article>`;
    })
    .join("");

  el.registrationInboxList.querySelectorAll(".registration-inbox-item").forEach((item) => {
    const installId = item.dataset.installId;
    item.querySelector('[data-action="approve"]')?.addEventListener("click", () => {
      void handleApproveRegistration(installId);
    });
    item.querySelector('[data-action="ignore"]')?.addEventListener("click", () => {
      void handleIgnoreRegistration(installId);
    });
  });
}

async function refreshRegistrationInbox() {
  clearError(el.registrationInboxError);
  try {
    const data = await api("/api/registry/registration-requests");
    updateRegistrationBadge(data.pendingCount ?? 0);
    renderRegistrationInbox(data.requests || []);
  } catch (error) {
    showError(el.registrationInboxError, error.message);
  }
}

async function openRegistrationInbox() {
  clearError(el.registrationInboxError);
  clearError(el.registryError);
  el.registrationInboxDialog.showModal();
  await refreshRegistrationInbox();
}

async function handleApproveRegistration(installId) {
  clearError(el.registrationInboxError);
  try {
    const result = await api(
      `/api/registry/registration-requests/${encodeURIComponent(installId)}/approve`,
      { method: "POST", body: "{}" },
    );
    await refreshRegistrationInbox();
    const assignedRelayId = result?.relayId || result?.entry?.relayId || "—";
    showInfo(
      el.registryInfo,
      `已同意申请并指派为 ${assignedRelayId}，Relay 将自动同步；Registry 概览请点击「刷新」。`,
    );
  } catch (error) {
    showError(el.registrationInboxError, error.message);
  }
}

async function handleIgnoreRegistration(installId) {
  if (
    !confirm(`忽视安装实例 ${installId} 的注册申请？\nRelay 可再次提交申请。`)
  ) {
    return;
  }
  clearError(el.registrationInboxError);
  try {
    await api(
      `/api/registry/registration-requests/${encodeURIComponent(installId)}/ignore`,
      { method: "POST" },
    );
    await refreshRegistrationInbox();
  } catch (error) {
    showError(el.registrationInboxError, error.message);
  }
}

async function loadRegistryPanel({ silent = false } = {}) {
  if (!silent) {
    clearError(el.registryError);
  }
  try {
    const overview = await api("/api/registry/relays/overview");
    renderRelayGrid(visibleRelays(overview.relays || []));
    void loadRegistrationBadge();
  } catch (error) {
    if (!silent) {
      showError(el.registryError, error.message);
    }
  }
}

async function commitPendingRemovals() {
  if (state.pendingRemovals.size === 0) {
    return true;
  }
  const ids = [...state.pendingRemovals];
  const label = ids.join("、");
  if (
    !confirm(
      `确认完成 ${ids.length} 个 Relay 的移除（${label}）？\n点击确定后将更新状态，且无法撤销。`,
    )
  ) {
    return false;
  }
  try {
    for (const relayId of ids) {
      await api(`/api/registry/allowlist/${encodeURIComponent(relayId)}`, {
        method: "DELETE",
      });
    }
    state.pendingRemovals.clear();
    return true;
  } catch (error) {
    showError(el.registryError, `移除失败：${error.message}`);
    return false;
  }
}

function invalidateRelayPanelConfig() {
  state.relayPanelConfig = null;
}

async function loadRelayPanelConfig() {
  if (state.relayPanelConfig) {
    return state.relayPanelConfig;
  }
  const [registryConfig, localRegistry] = await Promise.all([
    api("/api/config/relay-registry").catch(() => ({ registryUrl: null })),
    api("/api/config/local-registry").catch(() => ({ registryUrl: null })),
  ]);
  state.relayPanelConfig = {
    registryUrl: registryConfig?.registryUrl ?? null,
    localRegistryUrl: localRegistry?.registryUrl ?? null,
  };
  return state.relayPanelConfig;
}

async function loadRelayPanel({ silent = false } = {}) {
  if (!silent) {
    clearError(el.relayError);
  }
  try {
    const [relay, panelConfig] = await Promise.all([
      api("/api/relay/health"),
      loadRelayPanelConfig(),
    ]);
    const registryLocalRunning = Boolean(state.servicesStatus?.registry?.running);
    const registryPointsLocal = registryUrlPointsLocal(
      panelConfig.registryUrl,
      panelConfig.localRegistryUrl,
    );
    renderRelayOverview(relay, panelConfig.registryUrl, {
      registryLocalRunning,
      registryPointsLocal,
    });
  } catch (error) {
    if (!silent) {
      showError(el.relayError, error.message);
    }
  }
}

function refreshRelayOverviewConnectivity() {
  const cached = state.lastRelayOverview;
  if (!cached) return;
  const registryLocalRunning = Boolean(state.servicesStatus?.registry?.running);
  renderRelayOverview(cached.relay, cached.registryUrl, {
    ...cached.connectivityContext,
    registryLocalRunning,
  });
}

async function openRelayRegisterDialog() {
  clearError(el.relayRegisterError);
  clearError(el.relayError);
  clearInfo(el.relayInfo);
  try {
    const config = await api("/api/config/relay-registry");
    el.relayRegisterForm.registryUrl.value = config.registryUrl || "";
  } catch (error) {
    el.relayRegisterForm.registryUrl.value = "";
    showError(el.relayRegisterError, `读取 Relay 配置失败：${error.message}`);
  }
  el.relayRegisterDialog.showModal();
}

async function fillLocalRegistryUrl() {
  clearError(el.relayRegisterError);
  const config = await api("/api/config/local-registry");
  el.relayRegisterForm.registryUrl.value = config.registryUrl || "";
}

async function loadRelayPublicUrlConfig() {
  try {
    return await api("/api/config/relay-public-url");
  } catch (error) {
    if (error.message !== "Not Found") {
      throw error;
    }
    const localRelay = await api("/api/config/local-relay");
    const publicBaseUrl = localRelay.relayBaseUrl || "";
    let port = 9090;
    if (publicBaseUrl) {
      try {
        const parsed = new URL(publicBaseUrl);
        if (parsed.port) {
          port = Number(parsed.port);
        }
      } catch {
        // keep default port
      }
    }
    return {
      publicBaseUrl,
      localListenUrl: `http://127.0.0.1:${port}`,
      staleConsole: true,
    };
  }
}

async function openRelayPublicUrlDialog() {
  clearError(el.relayPublicUrlError);
  clearError(el.relayError);
  clearInfo(el.relayInfo);
  try {
    const config = await loadRelayPublicUrlConfig();
    el.relayPublicUrlForm.publicBaseUrl.value = config.publicBaseUrl || "";
    el.relayPublicUrlForm.dataset.localListenUrl = config.localListenUrl || "";
    if (config.staleConsole) {
      showError(
        el.relayPublicUrlError,
        "Console 服务尚未加载最新 API，请重启 Console 后再保存配置。当前仅可查看地址。",
      );
    }
  } catch (error) {
    el.relayPublicUrlForm.publicBaseUrl.value = "";
    showError(el.relayPublicUrlError, `读取 Relay 配置失败：${error.message}`);
  }
  el.relayPublicUrlDialog.showModal();
}

async function fillLocalRelayListenUrl() {
  clearError(el.relayPublicUrlError);
  const listenUrl = el.relayPublicUrlForm.dataset.localListenUrl;
  if (listenUrl) {
    el.relayPublicUrlForm.publicBaseUrl.value = listenUrl;
    return;
  }
  try {
    const config = await loadRelayPublicUrlConfig();
    el.relayPublicUrlForm.publicBaseUrl.value = config.localListenUrl || "";
    el.relayPublicUrlForm.dataset.localListenUrl = config.localListenUrl || "";
  } catch (error) {
    showError(el.relayPublicUrlError, error.message);
  }
}

async function submitRelayPublicUrl(publicBaseUrl) {
  clearError(el.relayError);
  clearInfo(el.relayInfo);
  const submitBtn = el.relayPublicUrlForm.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;
  try {
    const relayId = state.lastRelayOverview?.relay?.relayId;
    const body = { publicBaseUrl };
    if (relayId) {
      body.relayId = relayId;
    }
    const result = await api("/api/config/relay-public-url", {
      method: "PUT",
      body: JSON.stringify(body),
    });
    el.relayPublicUrlDialog.close();
    let message = "Public URL 已保存。请重启 Relay 使新地址在运行进程中生效。";
    if (result.allowlistSynced) {
      message += " Registry Allowlist 已同步更新。";
    } else if (relayId) {
      message += " Registry Allowlist 未能同步（可稍后在 Registry 面板手动更新）。";
    }
    showInfo(el.relayInfo, message);
    await loadRelayPanel();
  } catch (error) {
    const detail =
      error.message === "Not Found"
        ? "Console 服务需要重启以加载最新配置 API，请重启 Console 后重试。"
        : error.message;
    showError(el.relayPublicUrlError, detail);
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function submitRelayRegistration(registryUrl) {
  clearError(el.relayError);
  clearInfo(el.relayInfo);
  const submitBtn = el.relayRegisterForm.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;
  try {
    const result = await api("/api/relay/registration-request", {
      method: "POST",
      body: JSON.stringify({ registryUrl }),
    });
    invalidateRelayPanelConfig();
    el.relayRegisterDialog.close();
    await loadRelayPanel();
    void loadRegistrationBadge();
    if (result.status === "already_allowlisted") {
      showInfo(el.relayInfo, "Relay 已在 Registry Allowlist 中。");
    } else {
      showInfo(
        el.relayInfo,
        "已向 Registry 提交注册申请，请在 Registry 面板信封中审批。",
      );
    }
  } catch (error) {
    showError(el.relayRegisterError, error.message);
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function refreshActivePanel(options = {}) {
  if (isDatabaseView()) {
    await loadDatabaseView(state.panel);
    return;
  }
  if (state.panel === "registry") {
    await loadRegistryPanel(options);
  } else {
    await loadRelayPanel(options);
  }
}

function isBackgroundPollingPaused() {
  return !state.consoleEntered || document.hidden;
}

function isPanelPollingPaused() {
  if (!state.consoleEntered || document.hidden || isDatabaseView()) {
    return true;
  }
  if (state.refreshing || state.panelPolling) {
    return true;
  }
  if (state.servicePending.registry || state.servicePending.relay) {
    return true;
  }
  if (state.panel === "registry" && state.pendingRemovals.size > 0) {
    return true;
  }
  if (document.querySelector("dialog[open]")) {
    return true;
  }
  return false;
}

async function pollActivePanel() {
  if (isPanelPollingPaused()) {
    return;
  }
  state.panelPolling = true;
  try {
    await refreshActivePanel({ silent: true });
  } finally {
    state.panelPolling = false;
  }
}

async function pollRegistrationBadge() {
  if (isBackgroundPollingPaused()) {
    return;
  }
  // Registry 面板刷新时已顺带更新角标，避免重复请求
  if (state.panel === "registry" && !isDatabaseView()) {
    return;
  }
  await loadRegistrationBadge();
}

async function handleRefresh() {
  if (state.refreshing) {
    return;
  }
  clearPanelBanners();
  const startedAt = Date.now();
  setRefreshBusy(true);
  try {
    if (state.panel === "registry" && state.pendingRemovals.size > 0) {
      const committed = await commitPendingRemovals();
      if (!committed) {
        return;
      }
    }
    // 侧边栏服务状态另有 5s 轮询；刷新只更新当前面板，避免重复 health 探测
    await refreshActivePanel();
  } finally {
    await finishRefreshBusy(startedAt);
  }
}

function serviceLabel(name) {
  return name === "registry" ? "Registry" : "Relay";
}

function serviceElements(name) {
  if (name === "registry") {
    return {
      dotEl: el.registryServiceDot,
      buttonEl: el.startRegistryBtn,
      hintEl: el.registryServiceHint,
      errorEl: el.registryError,
    };
  }
  return {
    dotEl: el.relayServiceDot,
    buttonEl: el.startRelayBtn,
    hintEl: el.relayServiceHint,
    errorEl: el.relayError,
  };
}

function setServiceButtonLabel(buttonEl, text) {
  const label = buttonEl.querySelector(".service-btn-label");
  if (label) {
    label.textContent = text;
  } else {
    buttonEl.textContent = text;
  }
}

function setServiceHint(hintEl, serviceStatus, pending) {
  if (!hintEl) return;
  const running = Boolean(serviceStatus?.running);
  const managed = Boolean(serviceStatus?.managed);
  const external = Boolean(serviceStatus?.external);
  const pid = serviceStatus?.pid;

  if (pending === "starting") {
    hintEl.textContent = "等待启动…";
    hintEl.dataset.kind = "pending";
    return;
  }
  if (pending === "stopping") {
    hintEl.textContent = "等待关闭…";
    hintEl.dataset.kind = "pending";
    return;
  }
  if (!running) {
    hintEl.textContent = "未运行";
    hintEl.dataset.kind = "stopped";
    return;
  }
  if (managed) {
    hintEl.textContent = pid ? `托管 · PID ${pid}` : "托管";
    hintEl.dataset.kind = "new";
    return;
  }
  if (external || running) {
    if (pid) {
      hintEl.textContent = `独立 · PID ${pid}`;
      hintEl.dataset.kind = "pid";
      return;
    }
    hintEl.textContent = "";
    hintEl.dataset.kind = "hidden";
    return;
  }
  hintEl.textContent = "";
  hintEl.dataset.kind = "hidden";
}

function setServiceScanning(dotEl, buttonEl, hintEl) {
  dotEl.dataset.state = "unknown";
  buttonEl.disabled = true;
  buttonEl.dataset.phase = "scanning";
  setServiceButtonLabel(buttonEl, "—");
  if (hintEl) {
    hintEl.textContent = "扫描中…";
    hintEl.dataset.kind = "pending";
  }
}

function setServiceRestarting(dotEl, buttonEl, hintEl) {
  dotEl.dataset.state = "restarting";
  buttonEl.disabled = true;
  buttonEl.dataset.phase = "restarting";
  buttonEl.dataset.action = "stop";
  buttonEl.classList.add("danger");
  setServiceButtonLabel(buttonEl, "重启中");
  if (hintEl) {
    hintEl.textContent = "正在重启…";
    hintEl.dataset.kind = "pending";
  }
}

function setServiceWaiting(dotEl, buttonEl, hintEl, phase, serviceStatus) {
  dotEl.dataset.state = phase;
  buttonEl.disabled = true;
  buttonEl.dataset.phase = phase;
  buttonEl.dataset.action = phase === "starting" ? "start" : "stop";
  buttonEl.classList.toggle("danger", phase === "stopping");
  setServiceButtonLabel(buttonEl, phase === "starting" ? "启动中" : "关闭中");
  setServiceHint(hintEl, serviceStatus, phase);
}

function setServiceReady(dotEl, buttonEl, hintEl, serviceStatus) {
  const running = Boolean(serviceStatus?.running);
  dotEl.dataset.state = running ? "running" : "stopped";
  buttonEl.disabled = false;
  buttonEl.dataset.phase = "idle";
  buttonEl.dataset.action = running ? "stop" : "start";
  buttonEl.classList.toggle("danger", running);
  setServiceButtonLabel(buttonEl, running ? "关闭" : "启动");
  setServiceHint(hintEl, serviceStatus, null);
}

function applyServiceUi(name, serviceStatus) {
  const { dotEl, buttonEl, hintEl } = serviceElements(name);
  const pending = state.servicePending[name];
  const running = Boolean(serviceStatus?.running);

  if (pending === "restarting") {
    setServiceRestarting(dotEl, buttonEl, hintEl);
    return;
  }

  if (pending === "starting") {
    if (running) {
      state.servicePending[name] = null;
      setServiceReady(dotEl, buttonEl, hintEl, serviceStatus);
      return;
    }
    setServiceWaiting(dotEl, buttonEl, hintEl, "starting", serviceStatus);
    return;
  }

  if (pending === "stopping") {
    if (!running) {
      state.servicePending[name] = null;
      setServiceReady(dotEl, buttonEl, hintEl, { running: false });
      return;
    }
    setServiceWaiting(dotEl, buttonEl, hintEl, "stopping", serviceStatus);
    return;
  }

  setServiceReady(dotEl, buttonEl, hintEl, serviceStatus);
}

function setServicesScanning() {
  setServiceScanning(
    el.registryServiceDot,
    el.startRegistryBtn,
    el.registryServiceHint,
  );
  setServiceScanning(el.relayServiceDot, el.startRelayBtn, el.relayServiceHint);
}

async function fetchServiceStatus() {
  return api("/api/services/status");
}

async function loadServiceStatus() {
  if (isBackgroundPollingPaused()) {
    return null;
  }
  try {
    const prevRegistryRunning = state.servicesStatus?.registry?.running;
    const status = await fetchServiceStatus();
    state.servicesStatus = status;
    applyServiceUi("registry", status.registry);
    applyServiceUi("relay", status.relay);
    const registryRunningChanged = prevRegistryRunning !== status.registry?.running;
    if (
      registryRunningChanged &&
      state.panel === "relay" &&
      !isDatabaseView() &&
      state.lastRelayOverview
    ) {
      refreshRelayOverviewConnectivity();
    }
    return status;
  } catch {
    if (!state.servicePending.registry) {
      el.registryServiceDot.dataset.state = "unknown";
    }
    if (!state.servicePending.relay) {
      el.relayServiceDot.dataset.state = "unknown";
    }
    return null;
  }
}

async function startService(name, { detached = false } = {}) {
  if (state.servicePending[name]) {
    return;
  }

  const { errorEl } = serviceElements(name);
  clearError(errorEl);
  state.servicePending[name] = "starting";
  applyServiceUi(name, { running: false });

  try {
    await api(`/api/services/${name}/start`, {
      method: "POST",
      body: JSON.stringify({ detached }),
    });
    state.servicePending[name] = null;
    await loadServiceStatus();
    await refreshActivePanel();
  } catch (error) {
    state.servicePending[name] = null;
    await loadServiceStatus();
    const mode = detached ? "独立进程" : "";
    showError(errorEl, `${serviceLabel(name)}${mode ? ` ${mode}` : ""} 启动失败：${error.message}`);
  }
}

async function stopService(name, { confirm = true } = {}) {
  if (state.servicePending[name]) {
    return;
  }

  if (confirm && !window.confirm(`确定关闭 ${serviceLabel(name)}？`)) {
    return;
  }

  const { errorEl } = serviceElements(name);
  clearError(errorEl);
  state.servicePending[name] = "stopping";
  applyServiceUi(name, { running: true });

  try {
    await api(`/api/services/${name}/stop`, { method: "POST" });
    state.servicePending[name] = null;
    await loadServiceStatus();
    await refreshActivePanel();
  } catch (error) {
    state.servicePending[name] = null;
    await loadServiceStatus();
    showError(errorEl, `${serviceLabel(name)} 关闭失败：${error.message}`);
    throw error;
  }
}

async function restartService(name, { detached = false } = {}) {
  if (state.servicePending[name]) {
    return;
  }

  const modeLabel = detached ? "独立进程" : "托管";
  if (!window.confirm(`确定以${modeLabel}方式重启 ${serviceLabel(name)}？`)) {
    return;
  }

  const { errorEl } = serviceElements(name);
  clearError(errorEl);
  state.servicePending[name] = "restarting";
  applyServiceUi(name, { running: true });

  try {
    await api(`/api/services/${name}/stop`, { method: "POST" });
    await api(`/api/services/${name}/start`, {
      method: "POST",
      body: JSON.stringify({ detached }),
    });
    state.servicePending[name] = null;
    await loadServiceStatus();
    await refreshActivePanel();
  } catch (error) {
    state.servicePending[name] = null;
    await loadServiceStatus();
    showError(errorEl, `${serviceLabel(name)} 重启失败：${error.message}`);
  }
}

async function toggleService(name) {
  const { buttonEl } = serviceElements(name);
  if (state.servicePending[name] || buttonEl.disabled) {
    return;
  }
  const action = buttonEl.dataset.action || "start";
  if (action === "stop") {
    await stopService(name);
  } else {
    await startService(name);
  }
}

let welcomeLeaving = false;

function enterConsole(panel) {
  if (state.consoleEntered || welcomeLeaving) {
    return;
  }
  if (panel !== "registry" && panel !== "relay") {
    return;
  }

  welcomeLeaving = true;
  el.welcomeCards.forEach((card) => {
    const selected = card.dataset.panel === panel;
    card.classList.toggle("welcome-card--selected", selected);
    card.disabled = true;
  });
  el.welcomeScreen.classList.add("welcome-screen--leaving");

  window.setTimeout(() => {
    el.welcomeScreen.classList.add("hidden");
    el.appLayout.classList.remove("hidden");
    el.appLayout.classList.add("layout--entering");
    state.consoleEntered = true;
    welcomeLeaving = false;
    setServicesScanning();
    void scanServices();
    switchPanel(panel);
    window.setTimeout(() => {
      el.appLayout.classList.remove("layout--entering");
    }, 450);
  }, WELCOME_LEAVE_MS);
}

function initWelcomeScreen() {
  el.welcomeCards.forEach((card) => {
    card.addEventListener("click", () => {
      enterConsole(card.dataset.panel);
    });
  });
}

function switchPanel(name) {
  if (isDatabaseView()) {
    closeDatabaseView();
  }
  state.panel = name;
  el.navItems.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.panel === name);
  });
  el.panels.forEach((panel) => {
    panel.classList.toggle("active", panel.id === `panel-${name}`);
  });
  observeActiveRefreshBtn();
  refreshActivePanel();
}

el.navItems.forEach((btn) => {
  btn.addEventListener("click", () => switchPanel(btn.dataset.panel));
});

el.registryRefreshBtn.addEventListener("click", async () => {
  if (state.panel !== "registry") {
    switchPanel("registry");
  }
  await handleRefresh();
});

el.relayRefreshBtn.addEventListener("click", async () => {
  if (state.panel !== "relay") {
    switchPanel("relay");
  }
  await handleRefresh();
});

el.registryDbBtn.addEventListener("click", () => {
  openDatabaseView("registry");
});

el.relayDbBtn.addEventListener("click", () => {
  openDatabaseView("relay");
});

el.registryDbBackBtn.addEventListener("click", () => {
  closeDatabaseView();
});

el.relayDbBackBtn.addEventListener("click", () => {
  closeDatabaseView();
});

el.startRegistryBtn.addEventListener("click", () => {
  toggleService("registry");
});

el.startRelayBtn.addEventListener("click", () => {
  toggleService("relay");
});

function bindServiceContextMenu(buttonEl, serviceName) {
  buttonEl.addEventListener("contextmenu", (event) => {
    if (buttonEl.disabled) {
      return;
    }
    const action = buttonEl.dataset.action;
    if (action !== "start" && action !== "stop") {
      return;
    }
    event.preventDefault();
    closeContextMenu();
    openServiceContextMenu(event.clientX, event.clientY, serviceName, action);
  });
}

bindServiceContextMenu(el.startRegistryBtn, "registry");
bindServiceContextMenu(el.startRelayBtn, "relay");

el.serviceContextMenu.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button || !state.contextService) return;
  const service = state.contextService;
  closeServiceContextMenu();
  if (button.dataset.action === "start-detached") {
    await startService(service, { detached: true });
    return;
  }
  if (button.dataset.action === "restart-managed") {
    await restartService(service, { detached: false });
    return;
  }
  if (button.dataset.action === "restart-detached") {
    await restartService(service, { detached: true });
  }
});

el.registrationInboxBtn.addEventListener("click", () => {
  void openRegistrationInbox();
});

el.registrationInboxCloseBtn.addEventListener("click", () => {
  el.registrationInboxDialog.close();
});

el.relayRegisterBtn.addEventListener("click", () => {
  void openRelayRegisterDialog();
});

el.fillLocalRegistryBtn.addEventListener("click", () => {
  void fillLocalRegistryUrl().catch((error) => {
    showError(el.relayRegisterError, error.message);
  });
});

el.fillLocalRelayUrlBtn.addEventListener("click", () => {
  void fillLocalRelayListenUrl().catch((error) => {
    showError(el.relayPublicUrlError, error.message);
  });
});

el.relayPublicUrlForm.addEventListener("submit", (event) => {
  event.preventDefault();
  clearError(el.relayPublicUrlError);
  const form = new FormData(el.relayPublicUrlForm);
  const publicBaseUrl = String(form.get("publicBaseUrl") || "").trim();
  if (!publicBaseUrl) return;
  void submitRelayPublicUrl(publicBaseUrl);
});

el.relayRegisterForm.addEventListener("submit", (event) => {
  event.preventDefault();
  clearError(el.relayRegisterError);
  const form = new FormData(el.relayRegisterForm);
  const registryUrl = String(form.get("registryUrl") || "").trim();
  if (!registryUrl) return;
  void submitRelayRegistration(registryUrl);
});

el.manageRelayForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(el.manageRelayForm);
  const relayId = String(form.get("relayId") || "").trim();
  const relayBaseUrl = String(form.get("relayBaseUrl") || "").trim();
  const enabled = el.manageRelayForm.enabled.checked;
  try {
    await api(`/api/registry/allowlist/${encodeURIComponent(relayId)}`, {
      method: "PATCH",
      body: JSON.stringify({
        relayBaseUrl: relayBaseUrl || null,
        enabled,
      }),
    });
    el.manageRelayDialog.close();
    showInfo(el.registryInfo, "已保存，请点击「刷新」更新缩略图与数据库。");
  } catch (error) {
    showError(el.registryError, error.message);
  }
});

el.contextMenu.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button || !state.contextRelay) return;
  const relay = state.contextRelay;
  closeContextMenu();
  if (button.dataset.action === "manage") {
    openManageDialog(relay);
    return;
  }
  if (button.dataset.action === "remove") {
    if (
      !confirm(
        `将 ${relay.relayId} 标记为移除中？\n请点击「刷新」更新状态；此前可右键撤销。`,
      )
    ) {
      return;
    }
    state.pendingRemovals.add(relay.relayId);
    renderRelayGrid(state.relays);
    return;
  }
  if (button.dataset.action === "undo") {
    state.pendingRemovals.delete(relay.relayId);
    renderRelayGrid(state.relays);
  }
});

el.dbContextMenu.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button || !state.contextDbRow) return;
  const rowContext = state.contextDbRow;
  closeDbContextMenu();
  if (button.dataset.action !== "delete-row") return;
  const label = formatDbRowLabel(rowContext.keys);
  if (
    !confirm(
      `确认删除 ${rowContext.table} 中的行（${label}）？\n此操作不可撤销。`,
    )
  ) {
    return;
  }
  await deleteDbRow(rowContext);
});

document.addEventListener("click", (event) => {
  if (!el.contextMenu.contains(event.target)) {
    closeContextMenu();
  }
  if (!el.dbContextMenu.contains(event.target)) {
    closeDbContextMenu();
  }
  if (!el.serviceContextMenu.contains(event.target)) {
    closeServiceContextMenu();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (isDatabaseView()) {
      closeDatabaseView();
      return;
    }
    closeContextMenu();
    closeDbContextMenu();
    closeServiceContextMenu();
  }
});

for (const dialog of [
  el.registrationInboxDialog,
  el.relayRegisterDialog,
  el.relayPublicUrlDialog,
  el.manageRelayDialog,
]) {
  dialog.addEventListener("click", (event) => {
    const button = event.target.closest("button[value='cancel']");
    if (button) dialog.close();
  });
}

async function scanServices() {
  return loadServiceStatus();
}

async function bootstrap() {
  initBanners();
  initWelcomeScreen();
  state.consoleEntered = false;
  state.panel = "registry";
  state.view = "main";
  el.navItems.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.panel === "registry");
  });
  el.panels.forEach((panel) => {
    panel.classList.toggle("active", panel.id === "panel-registry");
  });
  applyViewMode();

  setInterval(loadServiceStatus, SERVICE_POLL_MS);
  setInterval(pollActivePanel, PANEL_POLL_MS);
  setInterval(pollRegistrationBadge, PANEL_POLL_MS);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state.consoleEntered) {
      void scanServices();
      void pollActivePanel();
      void pollRegistrationBadge();
      observeActiveRefreshBtn();
    } else {
      updateRefreshFabVisibility(true);
    }
  });
  initRefreshFab();
  initUrlTooltipFloat();
  document.querySelector(".main")?.addEventListener("scroll", hideUrlTooltip, { passive: true });
}

bootstrap();
