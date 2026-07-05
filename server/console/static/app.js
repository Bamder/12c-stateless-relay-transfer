const state = {
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
  servicePending: {
    registry: null,
    relay: null,
  },
};

const el = {
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
  for (const button of [el.registryRefreshBtn, el.relayRefreshBtn]) {
    if (!button) continue;
    button.disabled = busy;
    button.dataset.busy = busy ? "true" : "false";
  }
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
  const parts = relayId.split(/[-_]/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return relayId.slice(0, 2).toUpperCase();
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
  const head = columns.map((col) => `<th>${escapeHtml(col)}</th>`).join("");
  const body = rows
    .map((row) => {
      const keys = buildDbRowKeys(row, primaryKey);
      const deletable = keys !== null;
      const rowAttrs = deletable
        ? ` class="db-row" data-panel="${escapeHtml(panelSource)}" data-table="${escapeHtml(tableName)}" data-keys="${encodeDbRowPayload(keys)}"`
        : "";
      return `<tr${rowAttrs}>${columns.map((col) => `<td>${escapeHtml(formatCell(row[col]))}</td>`).join("")}</tr>`;
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

function renderRelayOverview(overview, health) {
  const relayIdLabel = formatRelayId(overview.relayId);
  const cards = [
    ["Relay ID", relayIdLabel, false],
    ["Public URL", overview.publicBaseUrl, true],
    ["已存块", overview.storedBlocks, false],
    ["容量上限", overview.maxBlocks, false],
    ["存储率", overview.storageRate != null ? overview.storageRate.toFixed(4) : "—", false],
    ["块 TTL (秒)", overview.blockMaxAgeSeconds, false],
    ["Registry Key", health?.registryApiKeyReady ? "就绪" : "未就绪", false],
    ["BlockAuth Key", health?.blockAuthKeyReady ? "就绪" : "未就绪", false],
  ];

  el.relayOverview.innerHTML = cards
    .map(([label, value, isUrl]) => {
      const text = String(value ?? "—");
      if (isUrl && text !== "—") {
        return `
      <div class="stat-card">
        <div class="label">${escapeHtml(label)}</div>
        <div class="value stat-value-url" data-full-url="${escapeHtml(text)}" tabindex="0">${escapeHtml(text)}</div>
      </div>`;
      }
      return `
      <div class="stat-card">
        <div class="label">${escapeHtml(label)}</div>
        <div class="value">${escapeHtml(text)}</div>
      </div>`;
    })
    .join("");
  bindUrlTooltips();
}

function showUrlTooltip(anchor) {
  const url = anchor.dataset.fullUrl;
  if (!url || !el.urlTooltipFloat) return;
  el.urlTooltipFloat.textContent = url;
  el.urlTooltipFloat.classList.remove("hidden");
  positionUrlTooltip(anchor, el.urlTooltipFloat);
}

function hideUrlTooltip() {
  el.urlTooltipFloat?.classList.add("hidden");
}

function positionUrlTooltip(anchor, floater) {
  const margin = 8;
  const rect = anchor.getBoundingClientRect();
  floater.style.left = "0px";
  floater.style.top = "0px";
  floater.style.maxWidth = `${Math.min(window.innerWidth - margin * 2, 640)}px`;

  let top = rect.bottom + 6;
  let left = rect.left;
  floater.style.left = `${left}px`;
  floater.style.top = `${top}px`;

  const floaterRect = floater.getBoundingClientRect();
  if (floaterRect.right > window.innerWidth - margin) {
    left = Math.max(margin, window.innerWidth - margin - floaterRect.width);
    floater.style.left = `${left}px`;
  }
  if (floaterRect.bottom > window.innerHeight - margin) {
    top = Math.max(margin, rect.top - floaterRect.height - 6);
    floater.style.top = `${top}px`;
  }
}

function bindUrlTooltips() {
  if (!el.urlTooltipFloat) return;
  for (const node of el.relayOverview.querySelectorAll(".stat-value-url[data-full-url]")) {
    node.addEventListener("mouseenter", () => showUrlTooltip(node));
    node.addEventListener("mouseleave", hideUrlTooltip);
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
  el.contextMenu.style.left = `${x}px`;
  el.contextMenu.style.top = `${y}px`;
}

function closeContextMenu() {
  el.contextMenu.classList.add("hidden");
  state.contextRelay = null;
}

function openDbContextMenu(x, y, rowContext) {
  closeContextMenu();
  closeServiceContextMenu();
  state.contextDbRow = rowContext;
  el.dbContextMenu.classList.remove("hidden");
  el.dbContextMenu.style.left = `${x}px`;
  el.dbContextMenu.style.top = `${y}px`;
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

function openServiceContextMenu(x, y, serviceName) {
  closeDbContextMenu();
  state.contextService = serviceName;
  el.serviceContextMenu.classList.remove("hidden");
  el.serviceContextMenu.style.left = `${x}px`;
  el.serviceContextMenu.style.top = `${y}px`;
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

async function loadRegistryPanel() {
  clearError(el.registryError);
  try {
    const overview = await api("/api/registry/relays/overview");
    renderRelayGrid(visibleRelays(overview.relays || []));
    void loadRegistrationBadge();
  } catch (error) {
    showError(el.registryError, error.message);
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

async function loadRelayPanel() {
  clearError(el.relayError);
  try {
    const [overview, health] = await Promise.all([
      api("/api/relay/overview"),
      api("/api/relay/health"),
    ]);
    renderRelayOverview(overview, health);
  } catch (error) {
    showError(el.relayError, error.message);
  }
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

async function refreshActivePanel() {
  if (isDatabaseView()) {
    await loadDatabaseView(state.panel);
    return;
  }
  if (state.panel === "registry") {
    await loadRegistryPanel();
  } else {
    await loadRelayPanel();
  }
}

async function handleRefresh() {
  if (state.refreshing) {
    return;
  }
  clearPanelBanners();
  setRefreshBusy(true);
  try {
    if (state.panel === "registry" && state.pendingRemovals.size > 0) {
      const committed = await commitPendingRemovals();
      if (!committed) {
        return;
      }
    }
    await scanServices();
    await refreshActivePanel();
  } finally {
    setRefreshBusy(false);
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
  try {
    const status = await fetchServiceStatus();
    applyServiceUi("registry", status.registry);
    applyServiceUi("relay", status.relay);
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

async function stopService(name) {
  if (state.servicePending[name]) {
    return;
  }

  if (!confirm(`确定关闭 ${serviceLabel(name)}？`)) {
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
    if (buttonEl.dataset.action !== "start" || buttonEl.disabled) {
      return;
    }
    event.preventDefault();
    closeContextMenu();
    openServiceContextMenu(event.clientX, event.clientY, serviceName);
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
  state.panel = "registry";
  state.view = "main";
  el.navItems.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.panel === "registry");
  });
  el.panels.forEach((panel) => {
    panel.classList.toggle("active", panel.id === "panel-registry");
  });
  applyViewMode();

  setServicesScanning();
  await scanServices();
  await refreshActivePanel();
  setInterval(loadServiceStatus, 5000);
  document.querySelector(".main")?.addEventListener("scroll", hideUrlTooltip, { passive: true });
}

bootstrap();
