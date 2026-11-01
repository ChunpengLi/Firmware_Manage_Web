const state = {
  meta: {
    categories: { firmware: "固件", software: "软件" },
    firmwareModels: [],
    gridModes: [],
    scenarios: [],
    softwareNames: [],
    storageRoot: "Cloudflare R2",
    storageRoots: {
      firmware: "R2/firmware",
      software: "R2/software"
    }
  },
  activePage: "firmware",
  records: {
    firmware: [],
    software: [],
    calendar: []
  },
  editingId: {
    firmware: null,
    software: null
  },
  calendar: {
    month: new Date().toISOString().slice(0, 7),
    selectedDate: ""
  },
  ai: {
    configured: false,
    model: "",
    busy: false,
    controller: null,
    messages: []
  },
  adminAuthenticated: false,
  publicDownloads: false
};

const validPages = ["firmware", "software", "calendar", "settings", "upgrade", "ai"];

const AI_QUICK_ACTIONS = [
  {
    label: "最新固件总览",
    prompt: "请列出目前最新的固件记录（按启用日期倒序，最多 8 条），逐条说明适用机型、适用场景、四种版本号（CPU1/CPU2/FPGA/ARM）和启用日期。"
  },
  {
    label: "按机型汇总",
    prompt: "请按适用机型对所有固件与软件记录分组汇总，列出每个机型下各固件/软件的最新版本与启用日期。"
  },
  {
    label: "软件版本清单",
    prompt: "请汇总所有软件记录，按软件名称分组，列出每个软件的全部版本号、启用日期、适用机型与说明。"
  },
  {
    label: "更新时间线",
    prompt: "请按启用日期梳理固件与软件的更新时间线，重点说明最近几次重要更新分别解决了什么（结合说明字段）。"
  },
  {
    label: "海外/特殊版本",
    prompt: "请找出所有说明中带有海外、英文、认证、特殊用途等关键词的记录，列出其版本号、适用机型与说明。"
  },
  {
    label: "机型详细报告",
    prompt: "请撰写一份详细的机型固件与软件日志报告：从系统记录里挑选记录数量最多的一个机型（并列则任选其一），覆盖机型概览、各适用场景下的固件版本清单（CPU1/CPU2/FPGA/ARM）与软件版本、启用日期、更新说明以及源码 SVN。报告要结构清晰、信息完整，便于我随后点击「导出 Word」保存为正式文档。"
  }
];

const selectors = {
  adminAccountButton: document.querySelector("#adminAccountButton"),
  adminLoginDialog: document.querySelector("#adminLoginDialog"),
  adminLoginForm: document.querySelector("#adminLoginForm"),
  adminPassword: document.querySelector("#adminPassword"),
  adminLoginStatus: document.querySelector("#adminLoginStatus"),
  adminLoginCancel: document.querySelector("#adminLoginCancel"),
  adminLoginSubmit: document.querySelector("#adminLoginSubmit"),
  storageRoot: document.querySelector("#storageRoot"),
  pageTabs: document.querySelectorAll("[data-page-link]"),
  pageViews: document.querySelectorAll("[data-page]"),
  firmwareDetail: {
    dialog: document.querySelector("#firmwareDetailDialog"),
    closeButton: document.querySelector("#firmwareDetailClose"),
    title: document.querySelector("#firmwareDetailTitle"),
    summary: document.querySelector("#firmwareDetailSummary"),
    content: document.querySelector("#firmwareDetailContent")
  },
  firmware: {
    form: document.querySelector("#firmwareForm"),
    formTitle: document.querySelector("#firmwareFormTitle"),
    status: document.querySelector("#firmwareStatus"),
    submitButton: document.querySelector("#firmwareSubmitButton"),
    cancelEditButton: document.querySelector("#firmwareCancelEditButton"),
    chosenFile: document.querySelector("#firmwareChosenFile"),
    packageFile: document.querySelector("#firmwareForm input[name='packageFile']"),
    refreshButton: document.querySelector("#firmwareRefreshButton"),
    rows: document.querySelector("#firmwareRows"),
    emptyState: document.querySelector("#firmwareEmptyState"),
    summary: document.querySelector("#firmwareSummary"),
    filters: {
      model: document.querySelector("#firmwareFilterModel"),
      gridMode: document.querySelector("#firmwareFilterGridMode"),
      version: document.querySelector("#firmwareFilterVersion"),
      keyword: document.querySelector("#firmwareFilterKeyword")
    }
  },
  software: {
    form: document.querySelector("#softwareForm"),
    formTitle: document.querySelector("#softwareFormTitle"),
    status: document.querySelector("#softwareStatus"),
    submitButton: document.querySelector("#softwareSubmitButton"),
    cancelEditButton: document.querySelector("#softwareCancelEditButton"),
    chosenFile: document.querySelector("#softwareChosenFile"),
    packageFile: document.querySelector("#softwareForm input[name='packageFile']"),
    refreshButton: document.querySelector("#softwareRefreshButton"),
    rows: document.querySelector("#softwareRows"),
    emptyState: document.querySelector("#softwareEmptyState"),
    summary: document.querySelector("#softwareSummary"),
    filters: {
      softwareName: document.querySelector("#softwareFilterName"),
      model: document.querySelector("#softwareFilterModel"),
      version: document.querySelector("#softwareFilterVersion"),
      keyword: document.querySelector("#softwareFilterKeyword")
    }
  },
  calendar: {
    month: document.querySelector("#calendarMonth"),
    prevMonth: document.querySelector("#calendarPrevMonth"),
    nextMonth: document.querySelector("#calendarNextMonth"),
    refreshButton: document.querySelector("#calendarRefreshButton"),
    grid: document.querySelector("#calendarGrid"),
    summary: document.querySelector("#calendarSummary"),
    emptyState: document.querySelector("#calendarEmptyState"),
    detailTitle: document.querySelector("#calendarDetailTitle"),
    detailSummary: document.querySelector("#calendarDetailSummary"),
    detailList: document.querySelector("#calendarDetailList"),
    filters: {
      category: document.querySelector("#calendarFilterCategory"),
      model: document.querySelector("#calendarFilterModel"),
      version: document.querySelector("#calendarFilterVersion"),
      keyword: document.querySelector("#calendarFilterKeyword")
    }
  },
  upgrade: {
    status: document.querySelector("#upgradeStatus")
  },
  settings: {
    status: document.querySelector("#settingsStatus"),
    editModelsBtn: document.querySelector("#editModelsBtn"),
    editScenariosBtn: document.querySelector("#editScenariosBtn"),
    editGridModesBtn: document.querySelector("#editGridModesBtn"),
    editSoftwareNamesBtn: document.querySelector("#editSoftwareNamesBtn")
  },
  optionsEditDialog: {
    dialog: document.querySelector("#optionsEditDialog"),
    title: document.querySelector("#optionsEditTitle"),
    list: document.querySelector("#optionsEditList"),
    closeButton: document.querySelector("#optionsEditClose"),
    cancelButton: document.querySelector("#optionsEditCancel"),
    saveButton: document.querySelector("#optionsEditSave")
  },
  scenarioDialog: {
    dialog: document.querySelector("#scenarioDialog"),
    title: document.querySelector("#scenarioDialogTitle"),
    closeButton: document.querySelector("#scenarioDialogClose"),
    list: document.querySelector("#scenarioList"),
    cancelButton: document.querySelector("#scenarioDialogCancel"),
    confirmButton: document.querySelector("#scenarioDialogConfirm")
  },
  ai: {
    status: document.querySelector("#aiStatus"),
    summary: document.querySelector("#aiSummary"),
    quickActions: document.querySelector("#aiQuickActions"),
    messages: document.querySelector("#aiMessages"),
    empty: document.querySelector("#aiEmpty"),
    form: document.querySelector("#aiForm"),
    input: document.querySelector("#aiInput"),
    sendButton: document.querySelector("#aiSendButton"),
    stopButton: document.querySelector("#aiStopButton"),
    clearButton: document.querySelector("#aiClearButton")
  }
};

function option(value, label = value) {
  const node = document.createElement("option");
  node.value = value;
  node.textContent = label;
  return node;
}

function fillSelect(select, values, placeholder) {
  select.innerHTML = "";
  if (placeholder) {
    select.append(option("", placeholder));
  }
  values.forEach((value) => select.append(option(value)));
}

function fillSelectGroup(selector, values, placeholder) {
  document.querySelectorAll(selector).forEach((select) => fillSelect(select, values, placeholder));
}

function debounce(fn, wait = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes)) return "-";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function joinDetails(values, escape = true) {
  const filtered = values.filter(Boolean);
  return escape ? filtered.map(escapeHtml).join("<br>") : filtered.join("<br>");
}

function categoryLabel(category) {
  return state.meta.categories[category] || category;
}

function setStatus(category, message, isError = false) {
  const status = selectors[category].status;
  status.textContent = message;
  status.classList.toggle("error", isError);
}

function updateAdminButton() {
  selectors.adminAccountButton.textContent = state.adminAuthenticated ? "管理员退出" : "管理员登录";
}

function requestAdminLogin() {
  if (state.adminAuthenticated) return Promise.resolve(true);
  selectors.adminLoginStatus.textContent = "";
  selectors.adminPassword.value = "";
  selectors.adminLoginDialog.showModal();
  selectors.adminPassword.focus();
  return new Promise((resolve) => {
    selectors.adminLoginDialog.addEventListener("close", () => resolve(state.adminAuthenticated), { once: true });
  });
}

async function submitAdminLogin(event) {
  event.preventDefault();
  selectors.adminLoginSubmit.disabled = true;
  selectors.adminLoginStatus.textContent = "正在验证…";
  try {
    await fetchJson("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: selectors.adminPassword.value })
    });
    state.adminAuthenticated = true;
    updateAdminButton();
    selectors.adminLoginDialog.close();
  } catch (error) {
    selectors.adminLoginStatus.textContent = error.message;
    selectors.adminLoginStatus.classList.add("error");
  } finally {
    selectors.adminLoginSubmit.disabled = false;
  }
}

async function logoutAdmin() {
  await fetchJson("/api/auth/logout", { method: "POST" });
  state.adminAuthenticated = false;
  updateAdminButton();
}

async function fetchJson(url, options) {
  let response = await fetch(url, options);
  if (response.status === 401 && !url.startsWith("/api/auth/")) {
    state.adminAuthenticated = false;
    updateAdminButton();
    if (await requestAdminLogin()) response = await fetch(url, options);
  }
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : null;
  if (!response.ok) {
    throw new Error(payload?.message || `请求失败（${response.status}）`);
  }
  return payload;
}

async function loadMeta() {
  state.meta = await fetchJson("/api/meta");
  state.publicDownloads = Boolean(state.meta.publicDownloads);
  updateStorageRootLabel(state.activePage);

  fillSelectGroup("[data-software-name]", state.meta.softwareNames);

  fillSelect(selectors.firmware.filters.model, state.meta.firmwareModels, "全部机型");
  fillSelect(selectors.firmware.filters.gridMode, state.meta.gridModes, "全部模式");
  fillSelect(selectors.software.filters.softwareName, state.meta.softwareNames, "全部软件");
  fillSelect(selectors.software.filters.model, state.meta.firmwareModels, "全部机型");
  fillSelect(selectors.calendar.filters.model, state.meta.firmwareModels, "全部机型");
}

function getStorageRootLabel(category) {
  const roots = state.meta.storageRoots || {};
  if (category === "software") {
    return roots.software || "R2/software";
  }
  if (category === "calendar" || category === "upgrade") {
    return `固件：${roots.firmware || "R2/firmware"}；软件：${roots.software || "R2/software"}`;
  }
  if (category === "ai") {
    return "AI助手 · 基于云端已登记记录";
  }
  return roots.firmware || "R2/firmware";
}

function updateStorageRootLabel(category) {
  selectors.storageRoot.textContent = getStorageRootLabel(category);
}

function getFilters(category) {
  const filters = selectors[category].filters;
  if (category === "calendar") {
    return {
      category: filters.category.value,
      model: filters.model.value,
      version: filters.version.value.trim(),
      keyword: filters.keyword.value.trim()
    };
  }
  if (category === "firmware") {
    return {
      category,
      model: filters.model.value,
      gridMode: filters.gridMode.value,
      version: filters.version.value.trim(),
      keyword: filters.keyword.value.trim()
    };
  }

  return {
    category,
    softwareName: filters.softwareName.value,
    model: filters.model.value,
    version: filters.version.value.trim(),
    keyword: filters.keyword.value.trim()
  };
}

function isManagedCategory(category) {
  return category === "firmware" || category === "software";
}

async function loadRecords(category) {
  const params = new URLSearchParams();
  Object.entries(getFilters(category)).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });

  state.records[category] = await fetchJson(`/api/firmwares?${params.toString()}`);
  renderRows(category, state.records[category]);
}

async function loadCalendarRecords() {
  const params = new URLSearchParams();
  Object.entries(getFilters("calendar")).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });

  state.records.calendar = await fetchJson(`/api/firmwares?${params.toString()}`);
  renderCalendar();
}

function formatMonthValue(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${date.getFullYear()}-${month}`;
}

function formatDateValue(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function setDefaultEnableDate(form) {
  if (form?.elements?.enableDate) {
    form.elements.enableDate.value = formatDateValue(new Date());
  }
}

function parseMonthValue(value) {
  const [year, month] = String(value || formatMonthValue(new Date())).split("-").map(Number);
  if (!year || !month) {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  }
  return new Date(year, month - 1, 1);
}

function addMonths(value, offset) {
  const date = parseMonthValue(value);
  date.setMonth(date.getMonth() + offset);
  return formatMonthValue(date);
}

function getMonthRecords() {
  return state.records.calendar.filter((item) => String(item.enableDate || "").startsWith(state.calendar.month));
}

function groupRecordsByDate(records) {
  return records.reduce((groups, item) => {
    const date = item.enableDate || "";
    if (!date) return groups;
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date).push(item);
    return groups;
  }, new Map());
}

function renderVersionInfo(item) {
  return [
    renderComponentVersion("CPU1", item.cpu1Version, item.cpu1SourceSvn),
    renderComponentVersion("CPU2", item.cpu2Version, item.cpu2SourceSvn),
    renderComponentVersion("FPGA", item.fpgaVersion, item.fpgaSourceSvn),
    renderComponentVersion("ARM", item.armVersion, item.armSourceSvn)
  ].join("");
}

function renderComponentVersion(label, version, sourceSvn) {
  return `
    <div class="version-info-line">
      <strong>${escapeHtml(label)}：${escapeHtml(version || "-")}</strong>
      <span>${renderSourceSvnLink(sourceSvn)}</span>
    </div>
  `;
}

function isSafeLink(value) {
  const lower = String(value || "").trim().toLowerCase();
  return /^[a-z][a-z0-9+.-]*:/.test(lower)
    && !lower.startsWith("javascript:")
    && !lower.startsWith("data:")
    && !lower.startsWith("vbscript:");
}

function renderSourceSvnLink(sourceSvn) {
  if (!sourceSvn) return "-";
  const link = String(sourceSvn).trim();
  const maxLength = 15;
  const label = link.length > maxLength ? `${link.substring(0, maxLength)}...` : link;
  const escapedLabel = escapeHtml(label);
  if (!isSafeLink(link)) return escapedLabel;
  return `<a class="svn-link" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(link)}">${escapedLabel}</a>`;
}

function renderFirmwareApplicableInfo(item) {
  const details = joinDetails([
    item.applicableSingleVersion ? `单机：${item.applicableSingleVersion}` : "",
    item.applicableMultiVersion ? `多机：${item.applicableMultiVersion}` : "",
    item.applicableAutomationVersion ? `自动化：${item.applicableAutomationVersion}` : "",
    item.description ? `说明：${item.description}` : ""
  ]);
  return details || "-";
}

function renderFileInfo(item) {
  return `
    <strong>${escapeHtml(item.originalFileName || item.fileName || "-")}</strong>
    <div class="file-meta">${formatSize(item.fileSize)}</div>
  `;
}

function renderActions(category, item) {
  const detailButton = category === "firmware"
    ? `<button class="secondary compact" type="button" data-detail="${escapeHtml(item.id)}">详情</button>`
    : "";

  return `
    <div class="actions">
      <div class="action-row">
        ${detailButton}
        <a class="download" href="/api/firmwares/${encodeURIComponent(item.id)}/download">下载</a>
      </div>
      <div class="action-row">
        <button class="secondary compact" type="button" data-edit="${escapeHtml(item.id)}">编辑</button>
        <button class="danger" type="button" data-delete="${escapeHtml(item.id)}">删除</button>
      </div>
    </div>
  `;
}

function renderMultiLines(value, asTag = false) {
  const items = String(value || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!items.length) return "-";
  return items
    .map((item) => (asTag ? `<span class="tag">${escapeHtml(item)}</span>` : `<strong>${escapeHtml(item)}</strong>`))
    .join("<br>");
}

function renderFirmwareRow(item) {
  return `
    <td>${renderMultiLines(item.model)}</td>
    <td>${renderMultiLines(item.scenario)}</td>
    <td>${renderVersionInfo(item)}</td>
    <td>${escapeHtml(item.enableDate || "-")}</td>
    <td>${renderMultiLines(item.gridMode, true)}</td>
    <td>${renderFirmwareApplicableInfo(item)}</td>
    <td>${renderActions("firmware", item)}</td>
  `;
}

function renderSoftwareRow(item) {
  return `
    <td><strong>${escapeHtml(item.softwareName || "-")}</strong></td>
    <td>${escapeHtml(item.version || "-")}</td>
    <td>${renderMultiLines(item.model)}</td>
    <td>${renderMultiLines(item.scenario)}</td>
    <td>${escapeHtml(item.enableDate || "-")}</td>
    <td>${escapeHtml(item.description || "-")}</td>
    <td>${renderFileInfo(item)}</td>
    <td>${escapeHtml(item.relativePath || "-")}</td>
    <td>${renderActions("software", item)}</td>
  `;
}

function renderRows(category, records) {
  const page = selectors[category];
  page.rows.innerHTML = "";
  page.emptyState.classList.toggle("visible", records.length === 0);
  page.summary.textContent = `${records.length} 个${categoryLabel(category)}文件`;

  const fragment = document.createDocumentFragment();
  records.forEach((item) => {
    const row = document.createElement("tr");
    row.innerHTML = category === "firmware" ? renderFirmwareRow(item) : renderSoftwareRow(item);
    fragment.append(row);
  });
  page.rows.append(fragment);
}

function renderCalendarSummary(item) {
  if (item.category === "software") {
    return [item.softwareName, item.version, item.model].filter(Boolean).join(" · ") || "软件更新";
  }
  const versions = [item.cpu1Version, item.cpu2Version, item.fpgaVersion, item.armVersion].filter(Boolean);
  const versionText = versions.length ? versions.join("/") : "";
  return [item.model, item.scenario, versionText].filter(Boolean).join(" · ") || "固件更新";
}

function renderCalendarDetailItem(item) {
  const details = item.category === "software"
    ? joinDetails([
        item.model ? `适用机型：${escapeHtml(item.model)}` : "",
        item.scenario ? `适用场景：${escapeHtml(item.scenario)}` : "",
        item.sourceSvn ? `源代码 SVN：${renderSourceSvnLink(item.sourceSvn)}` : "",
        item.description ? `说明：${escapeHtml(item.description)}` : ""
      ], false)
    : joinDetails([
        `CPU1：${escapeHtml(item.cpu1Version || "-")}`,
        item.cpu1SourceSvn ? `CPU1 SVN：${renderSourceSvnLink(item.cpu1SourceSvn)}` : "",
        `CPU2：${escapeHtml(item.cpu2Version || "-")}`,
        item.cpu2SourceSvn ? `CPU2 SVN：${renderSourceSvnLink(item.cpu2SourceSvn)}` : "",
        `FPGA：${escapeHtml(item.fpgaVersion || "-")}`,
        item.fpgaSourceSvn ? `FPGA SVN：${renderSourceSvnLink(item.fpgaSourceSvn)}` : "",
        `ARM：${escapeHtml(item.armVersion || "-")}`,
        item.armSourceSvn ? `ARM SVN：${renderSourceSvnLink(item.armSourceSvn)}` : "",
        item.gridMode ? `运行模式：${escapeHtml(item.gridMode)}` : "",
        item.description ? `说明：${escapeHtml(item.description)}` : ""
      ], false);

  return `
    <article class="calendar-detail-item">
      <div>
        <span class="tag ${item.category === "software" ? "tag-soft" : ""}">${escapeHtml(categoryLabel(item.category))}</span>
        <h3>${escapeHtml(renderCalendarSummary(item))}</h3>
        <p>${details || "-"}</p>
        <div class="file-meta">${escapeHtml(item.originalFileName || item.fileName || "-")} · ${formatSize(item.fileSize)}</div>
      </div>
      <a class="download" href="/api/firmwares/${encodeURIComponent(item.id)}/download">下载</a>
    </article>
  `;
}

function renderCalendarDetail(date, records) {
  const page = selectors.calendar;
  state.calendar.selectedDate = date || "";
  page.detailTitle.textContent = date ? `${date} 更新` : "当日更新";
  page.detailSummary.textContent = date ? `${records.length} 个更新记录` : "请选择有更新的日期";
  page.detailList.innerHTML = records.map(renderCalendarDetailItem).join("");
}

function renderCalendar() {
  const page = selectors.calendar;
  const monthStart = parseMonthValue(state.calendar.month);
  const monthRecords = getMonthRecords();
  const recordsByDate = groupRecordsByDate(monthRecords);
  const firstWeekday = (monthStart.getDay() + 6) % 7;
  const gridStart = new Date(monthStart);
  gridStart.setDate(monthStart.getDate() - firstWeekday);
  const todayKey = formatDateValue(new Date());

  page.month.value = state.calendar.month;
  page.summary.textContent = `${monthRecords.length} 个更新记录`;
  page.emptyState.classList.toggle("visible", monthRecords.length === 0);

  const selectedStillVisible = state.calendar.selectedDate && recordsByDate.has(state.calendar.selectedDate);
  if (!selectedStillVisible) {
    state.calendar.selectedDate = monthRecords[0]?.enableDate || "";
  }

  const fragment = document.createDocumentFragment();
  for (let index = 0; index < 42; index += 1) {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    const dateKey = formatDateValue(date);
    const dayRecords = recordsByDate.get(dateKey) || [];
    const isCurrentMonth = date.getMonth() === monthStart.getMonth();
    const isSelected = state.calendar.selectedDate === dateKey;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "calendar-day";
    button.dataset.date = dateKey;
    button.disabled = dayRecords.length === 0;
    button.classList.toggle("outside-month", !isCurrentMonth);
    button.classList.toggle("has-updates", dayRecords.length > 0);
    button.classList.toggle("today", dateKey === todayKey);
    button.classList.toggle("selected", isSelected);
    const visibleRecords = dayRecords.slice(0, 3);
    button.innerHTML = `
      <span class="calendar-date">${date.getDate()}</span>
      <span class="calendar-count">${dayRecords.length ? `${dayRecords.length} 项` : ""}</span>
      <span class="calendar-updates">
        ${visibleRecords.map((item) => `<span>${escapeHtml(renderCalendarSummary(item))}</span>`).join("")}
        ${dayRecords.length > visibleRecords.length ? `<span>+${dayRecords.length - visibleRecords.length} 更多</span>` : ""}
      </span>
    `;
    fragment.append(button);
  }
  page.grid.innerHTML = "";
  page.grid.append(fragment);
  renderCalendarDetail(state.calendar.selectedDate, recordsByDate.get(state.calendar.selectedDate) || []);
}

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function renderUpgradeStatus(status) {
  const page = selectors.upgrade;
  const message = status?.message || "尚未执行升级";
  const rows = [
    status?.stage ? `阶段：${status.stage}` : "",
    status?.fileName ? `文件：${status.fileName}` : "",
    status?.updatedAt ? `更新时间：${formatDateTime(status.updatedAt)}` : "",
    status?.copiedEntries?.length ? `已替换：${status.copiedEntries.join(", ")}` : "",
    status?.preservedEntries?.length ? `已保留：${status.preservedEntries.join(", ")}` : "",
    status?.installResult?.message || "",
    status?.restartRequired ? "提示：请重启服务，让后端代码完全生效。" : ""
  ].filter(Boolean);
  page.status.classList.toggle("error", Boolean(status && !status.running && status.ok === false));
  page.status.innerHTML = `
    <strong>${escapeHtml(message)}</strong>
    ${rows.length ? `<p>${rows.map(escapeHtml).join("<br>")}</p>` : ""}
  `;
}

async function loadUpgradeStatus() {
  const status = await fetchJson("/api/upgrade/status");
  renderUpgradeStatus(status);
}

function resetForm(category) {
  const page = selectors[category];
  const wasEditing = Boolean(state.editingId[category]);
  state.editingId[category] = null;
  page.form.reset();
  updatePickerDisplay(page.form);
  setDefaultEnableDate(page.form);
  page.packageFile.required = true;
  page.chosenFile.textContent = "尚未选择文件";
  page.formTitle.textContent = `上传${categoryLabel(category)}`;
  page.submitButton.textContent = "上传到服务器";
  page.cancelEditButton.hidden = true;
  if (!wasEditing) {
    setStatus(category, "");
  }
}

async function saveRecord(category, event) {
  event.preventDefault();
  const page = selectors[category];
  const wasEditing = Boolean(state.editingId[category]);
  const editingId = state.editingId[category];

  setStatus(category, wasEditing ? "正在保存..." : "正在上传...");
  try {
    const formData = new FormData(page.form);
    const file = page.packageFile.files[0];
    const record = Object.fromEntries([...formData.entries()].filter(([key]) => key !== "packageFile" && key !== "recordId"));
    if (file) {
      await uploadRecordFile(record, file, editingId);
    } else {
      await fetchJson(`/api/firmwares/${encodeURIComponent(editingId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(record)
      });
    }
    resetForm(category);
    setStatus(category, wasEditing ? "保存完成" : "上传完成");
    await loadRecords(category);
  } catch (error) {
    setStatus(category, error.message, true);
  }
}

async function uploadRecordFile(record, file, recordId) {
  const session = await fetchJson("/api/firmwares", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: file.name, size: file.size, mimeType: file.type, recordId, record })
  });
  const parts = [];
  try {
    const chunkSize = session.chunkSize || 8 * 1024 * 1024;
    const count = Math.ceil(file.size / chunkSize);
    for (let index = 0; index < count; index += 1) {
      const number = index + 1;
      const chunk = file.slice(index * chunkSize, Math.min(file.size, number * chunkSize));
      const result = await fetchJson(`/api/uploads/${encodeURIComponent(session.uploadId)}/parts/${number}`, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: await chunk.arrayBuffer()
      });
      parts.push(result);
      setStatus(record.category, `正在上传 ${Math.min(100, Math.round(number / count * 100))}%`);
    }
    await fetchJson(`/api/uploads/${encodeURIComponent(session.uploadId)}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parts })
    });
  } catch (error) {
    await fetchJson(`/api/uploads/${encodeURIComponent(session.uploadId)}/abort`, { method: "POST" }).catch(() => {});
    throw error;
  }
}

async function deleteRecord(category, id) {
  const confirmed = window.confirm(`确认删除这条${categoryLabel(category)}记录和服务器上的文件？`);
  if (!confirmed) return;

  await fetchJson(`/api/firmwares/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
  if (state.editingId[category] === id) {
    resetForm(category);
  }
  await loadRecords(category);
}

function detailRow(label, value, className = "") {
  return `
    <div class="detail-row ${className}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value || "-")}</strong>
    </div>
  `;
}

function detailVersionRow(label, version, sourceSvn) {
  return `
    <div class="detail-version-row">
      <strong class="detail-version-name">${escapeHtml(label)}</strong>
      <div>
        <span>版本号</span>
        <strong>${escapeHtml(version || "-")}</strong>
      </div>
      <div>
        <span>源代码 SVN</span>
        <strong>${renderSourceSvnLink(sourceSvn)}</strong>
      </div>
    </div>
  `;
}

function renderFirmwareDetail(item) {
  const basicRows = [
    ["记录 ID", item.id],
    ["适用机型", item.model || item.pcsModel],
    ["启用日期", item.enableDate || item.releaseDate],
    ["运行模式", item.gridMode],
    ["适用场景", item.scenario, "detail-row-wide"],
    ["适用单机上位机版本", item.applicableSingleVersion],
    ["适用多机上位机版本", item.applicableMultiVersion],
    ["适用自动化软件版本", item.applicableAutomationVersion],
    ["说明", item.description, "detail-row-wide"]
  ];
  const fileRows = [
    ["文件名称", item.originalFileName || item.fileName],
    ["文件大小", formatSize(item.fileSize)],
    ["文件类型", item.mimeType],
    ["服务器路径", item.relativePath],
    ["创建时间", item.createdAt],
    ["更新时间", item.updatedAt]
  ];

  return `
    <div class="detail-grid">
      ${basicRows.map(([label, value, className]) => detailRow(label, value, className)).join("")}
    </div>
    <section class="detail-section">
      <h3>固件版本与 SVN 对照</h3>
      <div class="detail-version-list">
        ${detailVersionRow("CPU1", item.cpu1Version, item.cpu1SourceSvn)}
        ${detailVersionRow("CPU2", item.cpu2Version, item.cpu2SourceSvn)}
        ${detailVersionRow("FPGA", item.fpgaVersion, item.fpgaSourceSvn)}
        ${detailVersionRow("ARM", item.armVersion, item.armSourceSvn)}
      </div>
    </section>
    <div class="detail-grid">
      ${fileRows.map(([label, value]) => detailRow(label, value)).join("")}
    </div>
    <details class="detail-json">
      <summary>JSON 原始记录</summary>
      <pre>${escapeHtml(JSON.stringify(item, null, 2))}</pre>
    </details>
  `;
}

async function showFirmwareDetail(id) {
  const detail = selectors.firmwareDetail;
  detail.title.textContent = "固件详情";
  detail.summary.textContent = "正在读取固件记录…";
  detail.content.innerHTML = "";
  detail.dialog.hidden = false;

  try {
    const item = await fetchJson(`/api/firmwares/${encodeURIComponent(id)}`);
    detail.title.textContent = `${item.model || item.pcsModel || "固件"} 详情`;
    detail.summary.textContent = "记录来源：Cloudflare D1";
    detail.content.innerHTML = renderFirmwareDetail(item);
  } catch (error) {
    detail.summary.textContent = "读取失败";
    detail.content.innerHTML = `<div class="empty visible">${escapeHtml(error.message)}</div>`;
  }
}

function closeFirmwareDetail() {
  selectors.firmwareDetail.dialog.hidden = true;
  selectors.firmwareDetail.content.innerHTML = "";
}

function resolvePageFromHash() {
  const page = location.hash.replace("#", "");
  return validPages.includes(page) ? page : "firmware";
}

function setFormValue(form, name, value) {
  if (form.elements[name]) {
    form.elements[name].value = value || "";
  }
}

function editRecord(category, id) {
  const page = selectors[category];
  const item = state.records[category].find((record) => record.id === id);
  if (!item) return;

  resetForm(category);
  state.editingId[category] = id;
  setFormValue(page.form, "recordId", id);
  setFormValue(page.form, "description", item.description);
  setFormValue(page.form, "model", item.model);
  setFormValue(page.form, "scenario", item.scenario);
  updatePickerDisplay(page.form);
  setFormValue(page.form, "enableDate", item.enableDate);

  page.packageFile.required = false;
  page.chosenFile.textContent = `保留原文件：${item.originalFileName || item.fileName}`;
  page.formTitle.textContent = `编辑${categoryLabel(category)}`;
  page.submitButton.textContent = "保存修改";
  page.cancelEditButton.hidden = false;

  if (category === "firmware") {
    [
      "cpu1Version",
      "cpu2Version",
      "fpgaVersion",
      "armVersion",
      "cpu1SourceSvn",
      "cpu2SourceSvn",
      "fpgaSourceSvn",
      "armSourceSvn",
      "gridMode",
      "applicableSingleVersion",
      "applicableMultiVersion",
      "applicableAutomationVersion"
    ].forEach((name) => setFormValue(page.form, name, item[name]));
  } else {
    setFormValue(page.form, "softwareName", item.softwareName);
    setFormValue(page.form, "version", item.version);
    setFormValue(page.form, "sourceSvn", item.sourceSvn);
  }

  setStatus(category, "正在编辑已有记录");
  page.form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function setActivePage(category) {
  state.activePage = category;
  updateStorageRootLabel(category);
  selectors.pageViews.forEach((view) => {
    const isActive = view.dataset.page === category;
    view.hidden = !isActive;
    view.classList.toggle("active", isActive);
  });
  selectors.pageTabs.forEach((tab) => {
    const isActive = tab.dataset.pageLink === category;
    tab.classList.toggle("active", isActive);
    tab.setAttribute("aria-current", isActive ? "page" : "false");
  });
  if (isManagedCategory(category)) {
    loadRecords(category).catch((error) => setStatus(category, error.message, true));
  } else if (category === "calendar") {
    loadCalendarRecords().catch((error) => {
      selectors.calendar.summary.textContent = error.message;
    });
  } else if (category === "upgrade") {
    loadUpgradeStatus().catch((error) => {
      renderUpgradeStatus({ running: false, ok: false, message: error.message });
    });
  } else if (category === "ai") {
    loadAiStatus().catch((error) => setAiStatus(error.message, true));
  }
}

function updateChosenFile(fileInput, chosenFile, emptyText) {
  const [file] = fileInput.files;
  chosenFile.textContent = file ? `${file.name} - ${formatSize(file.size)}` : emptyText;
}

async function assignDroppedFile(fileInput, files) {
  const items = Array.from(files || []);
  if (!items.length) return;

  const hasDirectory = items.some((item) => item.type === "" && item.name.includes("/"));

  if (!hasDirectory) {
    const [file] = items;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    fileInput.files = transfer.files;
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }

  const zip = new JSZip();
  for (const item of items) {
    await processDroppedItem(zip, item, "");
  }

  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  const folderName = items.find((item) => item.type === "" && item.name.includes("/"))?.name.split("/")[0] || "folder";
  const zipFileName = `${folderName}.zip`;
  const zipFile = new File([blob], zipFileName, { type: "application/zip" });

  const transfer = new DataTransfer();
  transfer.items.add(zipFile);
  fileInput.files = transfer.files;
  fileInput.dispatchEvent(new Event("change", { bubbles: true }));
}

async function processDroppedItem(zip, item, parentPath) {
  if (item.type) {
    const content = await item.arrayBuffer();
    const filePath = parentPath ? `${parentPath}/${item.name}` : item.name;
    zip.file(filePath, content);
    return;
  }

  const directoryName = item.name.split("/")[0];
  const newParentPath = parentPath ? `${parentPath}/${directoryName}` : directoryName;
  const entries = await item.getEntries?.();
  if (entries) {
    for (const entry of entries) {
      await processDroppedItem(zip, entry, newParentPath);
    }
  }
}

function bindFileDrop(page) {
  const fileInput = page.packageFile;
  const dropZone = fileInput.closest(".file-drop");
  const emptyText = page.chosenFile.textContent;

  fileInput.addEventListener("change", () => {
    updateChosenFile(fileInput, page.chosenFile, emptyText);
  });

  if (!dropZone) return;

  ["dragenter", "dragover"].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.add("drag-over");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      if (eventName === "dragleave" && dropZone.contains(event.relatedTarget)) {
        return;
      }
      dropZone.classList.remove("drag-over");
    });
  });

  dropZone.addEventListener("drop", (event) => {
    assignDroppedFile(fileInput, event.dataTransfer?.files);
  });
}

function bindPageEvents(category) {
  const page = selectors[category];
  page.form.addEventListener("submit", (event) => saveRecord(category, event));
  page.cancelEditButton.addEventListener("click", () => {
    resetForm(category);
    setStatus(category, "已取消编辑");
  });
  bindFileDrop(page);
  const reloadList = debounce(() => loadRecords(category), 250);
  Object.values(page.filters).forEach((control) => {
    control.addEventListener("input", reloadList);
    control.addEventListener("change", reloadList);
  });
  page.refreshButton.addEventListener("click", () => loadRecords(category));
  page.rows.addEventListener("click", async (event) => {
    const detailId = event.target.dataset.detail;
    const deleteId = event.target.dataset.delete;
    const editId = event.target.dataset.edit;
    if (detailId) {
      await showFirmwareDetail(detailId);
      return;
    }
    if (deleteId) {
      await deleteRecord(category, deleteId);
    }
    if (editId) {
      editRecord(category, editId);
    }
  });
}

function bindCalendarEvents() {
  const page = selectors.calendar;
  page.month.value = state.calendar.month;
  page.month.addEventListener("change", () => {
    state.calendar.month = page.month.value || formatMonthValue(new Date());
    state.calendar.selectedDate = "";
    renderCalendar();
  });
  page.prevMonth.addEventListener("click", () => {
    state.calendar.month = addMonths(state.calendar.month, -1);
    state.calendar.selectedDate = "";
    renderCalendar();
  });
  page.nextMonth.addEventListener("click", () => {
    state.calendar.month = addMonths(state.calendar.month, 1);
    state.calendar.selectedDate = "";
    renderCalendar();
  });
  page.refreshButton.addEventListener("click", () => loadCalendarRecords());
  const reloadCalendar = debounce(() => loadCalendarRecords(), 250);
  Object.values(page.filters).forEach((control) => {
    control.addEventListener("input", reloadCalendar);
    control.addEventListener("change", reloadCalendar);
  });
  page.grid.addEventListener("click", (event) => {
    const day = event.target.closest(".calendar-day");
    if (!day || day.disabled) return;
    state.calendar.selectedDate = day.dataset.date;
    renderCalendar();
  });
}

function bindSettingsEvents() {
  const page = selectors.settings;
  const dialog = selectors.optionsEditDialog;

  page.editModelsBtn.addEventListener("click", () => openOptionsEditDialog("models", "机型选项"));
  page.editScenariosBtn.addEventListener("click", () => openOptionsEditDialog("scenarios", "场景选项"));
  page.editGridModesBtn.addEventListener("click", () => openOptionsEditDialog("gridModes", "运行模式选项"));
  page.editSoftwareNamesBtn.addEventListener("click", () => openOptionsEditDialog("softwareNames", "软件名称选项"));

  dialog.closeButton.addEventListener("click", closeOptionsEditDialog);
  dialog.cancelButton.addEventListener("click", closeOptionsEditDialog);
  dialog.saveButton.addEventListener("click", saveOptions);
  dialog.dialog.addEventListener("click", (event) => {
    if (event.target === dialog.dialog) {
      closeOptionsEditDialog();
    }
  });
}

let currentOptionsType = "";
let currentOptionsData = [];

async function openOptionsEditDialog(type, title) {
  currentOptionsType = type;
  selectors.optionsEditDialog.title.textContent = title;

  try {
    const options = await fetchJson("/api/options");
    currentOptionsData = options[type] || [];

    const list = selectors.optionsEditDialog.list;
    list.innerHTML = currentOptionsData.map((item, index) => `
      <div class="options-edit-item">
        <span class="options-edit-index">${index}</span>
        <input type="text" class="options-edit-input" value="${escapeHtml(item)}" data-index="${index}" />
        ${index > 0 ? `<button class="options-edit-remove" type="button" data-index="${index}">×</button>` : ""}
      </div>
    `).join("") + `
      <button class="options-edit-add" type="button">+ 添加新选项</button>
    `;

    list.querySelectorAll(".options-edit-remove").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        const index = parseInt(event.target.dataset.index, 10);
        removeOption(index);
      });
    });

    list.querySelector(".options-edit-add").addEventListener("click", addOption);

    selectors.optionsEditDialog.dialog.hidden = false;
  } catch (error) {
    setStatus("settings", error.message, true);
  }
}

function addOption() {
  currentOptionsData.push("");
  const list = selectors.optionsEditDialog.list;
  const index = currentOptionsData.length - 1;
  const addBtn = list.querySelector(".options-edit-add");
  const newItem = document.createElement("div");
  newItem.className = "options-edit-item";
  newItem.innerHTML = `
    <span class="options-edit-index">${index}</span>
    <input type="text" class="options-edit-input" value="" data-index="${index}" />
    <button class="options-edit-remove" type="button" data-index="${index}">×</button>
  `;
  newItem.querySelector(".options-edit-remove").addEventListener("click", (event) => {
    const idx = parseInt(event.target.dataset.index, 10);
    removeOption(idx);
  });
  list.insertBefore(newItem, addBtn);
  updateOptionIndices();
}

function removeOption(index) {
  currentOptionsData.splice(index, 1);
  const list = selectors.optionsEditDialog.list;
  const items = list.querySelectorAll(".options-edit-item");
  items[index].remove();
  updateOptionIndices();
}

function updateOptionIndices() {
  const list = selectors.optionsEditDialog.list;
  const items = list.querySelectorAll(".options-edit-item");
  items.forEach((item, index) => {
    item.querySelector(".options-edit-index").textContent = index;
    item.querySelector(".options-edit-input").dataset.index = index;
    const removeBtn = item.querySelector(".options-edit-remove");
    if (removeBtn) {
      removeBtn.dataset.index = index;
    }
  });
}

function closeOptionsEditDialog() {
  selectors.optionsEditDialog.dialog.hidden = true;
  currentOptionsType = "";
  currentOptionsData = [];
}

async function saveOptions() {
  if (!currentOptionsType) return;

  const inputs = selectors.optionsEditDialog.list.querySelectorAll(".options-edit-input");
  const newValues = Array.from(inputs).map((input) => input.value.trim()).filter(Boolean);

  try {
    const result = await fetchJson("/api/options", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        models: currentOptionsType === "models" ? newValues : state.meta.firmwareModels,
        scenarios: currentOptionsType === "scenarios" ? newValues : state.meta.scenarios,
        gridModes: currentOptionsType === "gridModes" ? newValues : state.meta.gridModes,
        softwareNames: currentOptionsType === "softwareNames" ? newValues : state.meta.softwareNames
      })
    });

    if (result.ok) {
      await loadMeta();
      const affected = result.changes?.affectedRecords || 0;
      const note = affected > 0 ? `；已自动同步 ${affected} 处已有记录（改名跟随、删除项迁移到未分类）` : "";
      setStatus("settings", "保存成功，选项已即时生效" + note);
      closeOptionsEditDialog();
    } else {
      setStatus("settings", result.message || "保存失败", true);
    }
  } catch (error) {
    setStatus("settings", error.message, true);
  }
}

function bindUpgradeEvents() {
  selectors.adminAccountButton.addEventListener("click", async () => {
    if (state.adminAuthenticated) await logoutAdmin();
    else await requestAdminLogin();
  });
  selectors.adminLoginForm.addEventListener("submit", submitAdminLogin);
  selectors.adminLoginCancel.addEventListener("click", () => selectors.adminLoginDialog.close());
  document.addEventListener("click", async (event) => {
    const link = event.target.closest("a[href*='/download']");
    if (!link || state.publicDownloads || state.adminAuthenticated) return;
    event.preventDefault();
    if (await requestAdminLogin()) location.assign(link.href);
  }, true);
}

let currentPicker = {
  field: null,
  form: null,
  optionsKey: "scenarios",
  title: "选择选项",
  placeholder: "请选择"
};

function bindPickerEvents() {
  const dialog = selectors.scenarioDialog;
  dialog.closeButton.addEventListener("click", closePicker);
  dialog.cancelButton.addEventListener("click", closePicker);
  dialog.confirmButton.addEventListener("click", confirmPickerSelection);
  dialog.dialog.addEventListener("click", (event) => {
    if (event.target === dialog.dialog) {
      closePicker();
    }
  });

  document.querySelectorAll("[data-multi-picker]").forEach((button) => {
    button.addEventListener("click", () => {
      const label = button.closest("label");
      currentPicker = {
        field: label.querySelector('input[type="hidden"]'),
        form: label.closest("form"),
        optionsKey: button.dataset.optionsKey || "scenarios",
        title: button.dataset.pickerTitle || "选择选项",
        placeholder: button.dataset.pickerPlaceholder || "请选择"
      };
      openPicker();
    });
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !dialog.dialog.hidden) {
      closePicker();
    }
  });
}

function openPicker() {
  const dialog = selectors.scenarioDialog;
  if (dialog.title) {
    dialog.title.textContent = currentPicker.title;
  }
  renderPickerList();
  dialog.dialog.hidden = false;
}

function closePicker() {
  selectors.scenarioDialog.dialog.hidden = true;
}

function renderPickerList() {
  const list = selectors.scenarioDialog.list;
  const options = state.meta[currentPicker.optionsKey] || [];
  const selectedValues = currentPicker.field?.value ? currentPicker.field.value.split(",") : [];

  list.innerHTML = options.map((value) => {
    const isSelected = selectedValues.includes(value);
    return `
      <div class="scenario-option ${isSelected ? "selected" : ""}" data-value="${escapeHtml(value)}">
        <input type="checkbox" ${isSelected ? "checked" : ""} />
        <label>${escapeHtml(value)}</label>
      </div>
    `;
  }).join("");

  list.querySelectorAll(".scenario-option").forEach((option) => {
    option.addEventListener("click", () => {
      const checkbox = option.querySelector("input[type='checkbox']");
      checkbox.checked = !checkbox.checked;
      option.classList.toggle("selected", checkbox.checked);
    });
  });
}

function confirmPickerSelection() {
  const list = selectors.scenarioDialog.list;
  const selected = Array.from(list.querySelectorAll("input[type='checkbox']:checked"))
    .map((checkbox) => checkbox.closest(".scenario-option").dataset.value);

  if (currentPicker.field) {
    currentPicker.field.value = selected.join(",");
  }
  updatePickerDisplay(currentPicker.form);
  closePicker();
}

function updatePickerDisplay(form) {
  if (!form) return;
  form.querySelectorAll("[data-multi-picker]").forEach((button) => {
    const label = button.closest("label");
    const hiddenInput = label.querySelector('input[type="hidden"]');
    const selectedContainer = label.querySelector(".selected-scenarios");
    const placeholder = button.dataset.pickerPlaceholder || "请选择";
    const value = hiddenInput?.value || "";
    const items = value ? value.split(",") : [];

    button.textContent = items.length ? `${items.length} 项已选` : placeholder;

    if (selectedContainer) {
      selectedContainer.innerHTML = items.map((item) => `
        <span class="scenario-tag">
          ${escapeHtml(item)}
          <button type="button" data-remove-item="${escapeHtml(item)}">×</button>
        </span>
      `).join("");

      selectedContainer.querySelectorAll("[data-remove-item]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const removeItem = btn.dataset.removeItem;
          const newItems = items.filter((s) => s !== removeItem);
          hiddenInput.value = newItems.join(",");
          updatePickerDisplay(form);
        });
      });
    }
  });
}

function setAiStatus(message, isError = false) {
  const status = selectors.ai.status;
  status.textContent = message;
  status.classList.toggle("error", isError);
}

async function loadAiStatus() {
  const status = await fetchJson("/api/ai/status");
  state.ai.configured = Boolean(status.configured);
  state.ai.model = status.model || "";
  if (state.ai.configured) {
    setAiStatus(`已就绪 · 模型 ${state.ai.model} · ${status.recordCount} 条记录`);
  } else {
    setAiStatus("未配置：请在 ai_workspace/ai_config.json 填写密钥", true);
  }
}

function renderAiQuickActions() {
  const container = selectors.ai.quickActions;
  container.innerHTML = "";
  AI_QUICK_ACTIONS.forEach((action) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ai-chip";
    button.textContent = action.label;
    button.addEventListener("click", () => askAi(action.prompt));
    container.append(button);
  });
}

function scrollAiMessages() {
  const container = selectors.ai.messages;
  container.scrollTop = container.scrollHeight;
}

function inlineAiMarkdown(text) {
  return text
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
}

function renderAiMarkdown(text) {
  const lines = String(text || "").split(/\r?\n/);
  const out = [];
  let listType = null;
  const closeList = () => {
    if (listType) {
      out.push(listType === "ul" ? "</ul>" : "</ol>");
      listType = null;
    }
  };
  lines.forEach((rawLine) => {
    const line = rawLine.replace(/\s+$/, "");
    if (!line.trim()) {
      closeList();
      return;
    }
    const dl = line.match(/^\[\[DOWNLOAD\s+id="([^"]+)"(?:\s+name="([^"]*?)")?\s*\]\]$/i);
    if (dl) {
      closeList();
      const fileId = dl[1];
      const fileName = dl[2] || "文件";
      out.push(
        '<a class="ai-file-card" href="/api/firmwares/' + encodeURIComponent(fileId) + '/download" download>'
        + '<span class="ai-file-glyph">文件</span>'
        + '<span class="ai-file-meta">'
        + '<span class="ai-file-name">' + escapeHtml(fileName) + '</span>'
        + '<span class="ai-file-hint">点击下载</span>'
        + '</span></a>'
      );
      return;
    }
    const escaped = escapeHtml(line);
    const ulMatch = escaped.match(/^\s*([-*•])\s+(.*)$/);
    const olMatch = escaped.match(/^\s*\d+[.)、]\s+(.*)$/);
    if (ulMatch) {
      if (listType !== "ul") {
        closeList();
        out.push("<ul>");
        listType = "ul";
      }
      out.push(`<li>${inlineAiMarkdown(ulMatch[2])}</li>`);
    } else if (olMatch) {
      if (listType !== "ol") {
        closeList();
        out.push("<ol>");
        listType = "ol";
      }
      out.push(`<li>${inlineAiMarkdown(olMatch[1])}</li>`);
    } else {
      closeList();
      out.push(`<p>${inlineAiMarkdown(escaped)}</p>`);
    }
  });
  closeList();
  return out.join("");
}

function buildAiCopyButton(getText) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ai-copy-btn secondary compact";
  button.textContent = "复制";
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(getText());
      button.textContent = "已复制";
      setTimeout(() => {
        button.textContent = "复制";
      }, 1500);
    } catch {
      button.textContent = "复制失败";
      setTimeout(() => {
        button.textContent = "复制";
      }, 1500);
    }
  });
  return button;
}

function deriveAiDocxTitle(text) {
  const firstLine = String(text || "").split(/\r?\n/).map((l) => l.trim()).find(Boolean) || "AI报告";
  return firstLine.replace(/^#+\s*/, "").replace(/^[-*•]\s*/, "").replace(/^\d+[.)、]\s*/, "").slice(0, 60).trim() || "AI报告";
}

function buildAiExportWordButton(getText) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ai-copy-btn secondary compact";
  button.textContent = "导出 Word";
  button.addEventListener("click", async () => {
    const text = getText();
    if (!text || !text.trim()) return;
    const title = deriveAiDocxTitle(text);
    const previous = button.textContent;
    button.disabled = true;
    button.textContent = "生成中…";
    try {
      if (!await requestAdminLogin()) throw new Error("管理员登录已取消");
      const response = await fetch("/api/ai/export/docx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content: text })
      });
      if (!response.ok) {
        let message = `导出失败（${response.status}）`;
        try {
          const payload = await response.json();
          if (payload && payload.message) message = payload.message;
        } catch {
          // 忽略 JSON 解析失败
        }
        throw new Error(message);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${title}.docx`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      button.textContent = "已导出";
    } catch (error) {
      button.textContent = error && error.message ? error.message : "导出失败";
    } finally {
      setTimeout(() => {
        button.textContent = previous;
        button.disabled = false;
      }, 1800);
    }
  });
  return button;
}

function appendAiMessage(role) {
  const wrap = document.createElement("div");
  wrap.className = `ai-msg ai-msg-${role}`;
  const bubble = document.createElement("div");
  bubble.className = "ai-bubble";
  wrap.append(bubble);
  selectors.ai.messages.append(wrap);
  selectors.ai.empty.style.display = "none";
  scrollAiMessages();
  return { wrap, bubble };
}

function setAiBubbleContent(bubble, text, fallback) {
  const value = text || "";
  if (value.trim()) {
    bubble.innerHTML = renderAiMarkdown(value);
    bubble.classList.remove("ai-cursor");
  } else {
    bubble.textContent = fallback || "";
  }
}

function setAiBubbleStreaming(bubble, text) {
  bubble.innerHTML = renderAiMarkdown(text);
  bubble.classList.add("ai-cursor");
}

function setAiBubbleError(wrap, bubble, message) {
  wrap.classList.add("ai-msg-error");
  bubble.innerHTML = escapeHtml(message || "AI 返回错误");
}

function updateAiBusy() {
  selectors.ai.sendButton.hidden = state.ai.busy;
  selectors.ai.stopButton.hidden = !state.ai.busy;
  selectors.ai.input.disabled = state.ai.busy;
  selectors.ai.clearButton.disabled = state.ai.busy;
  selectors.ai.quickActions.querySelectorAll(".ai-chip").forEach((chip) => {
    chip.disabled = state.ai.busy;
  });
}

function autoGrowAiInput() {
  const textarea = selectors.ai.input;
  textarea.style.height = "auto";
  textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
}

function submitAi(event) {
  if (event && typeof event.preventDefault === "function") event.preventDefault();
  if (state.ai.busy) return;
  if (!state.ai.configured) {
    setAiStatus("AI 未配置，无法提问，请先填写 ai_config.json。", true);
    return;
  }
  const value = selectors.ai.input.value.trim();
  if (!value) return;
  state.ai.messages.push({ role: "user", content: value });
  appendAiMessage("user").bubble.textContent = value;
  selectors.ai.input.value = "";
  autoGrowAiInput();
  streamAiAnswer();
}

function askAi(prompt) {
  if (state.ai.busy) return;
  selectors.ai.input.value = prompt;
  autoGrowAiInput();
  submitAi({ preventDefault() {} });
}

function stopAi() {
  if (state.ai.controller) state.ai.controller.abort();
}

function clearAiConversation() {
  if (state.ai.busy) return;
  state.ai.messages = [];
  selectors.ai.messages.innerHTML = "";
  selectors.ai.empty.style.display = "";
}

async function streamAiAnswer() {
  const { wrap, bubble } = appendAiMessage("assistant");
  if (!await requestAdminLogin()) {
    setAiBubbleError(wrap, bubble, "管理员登录已取消");
    return;
  }
  const controller = new AbortController();
  state.ai.controller = controller;
  state.ai.busy = true;
  updateAiBusy();
  bubble.textContent = "正在思考…";
  let acc = "";
  let committed = false;

  const commitAssistant = (finalText) => {
    if (committed) return;
    committed = true;
    const text = finalText || acc;
    if (text.trim()) {
      state.ai.messages.push({ role: "assistant", content: text });
      bubble.classList.remove("ai-cursor");
      const actions = document.createElement("div");
      actions.className = "ai-msg-actions";
      actions.append(buildAiCopyButton(() => text));
      actions.append(buildAiExportWordButton(() => text));
      wrap.append(actions);
    }
  };

  try {
    const response = await fetch("/api/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: state.ai.messages }),
      signal: controller.signal
    });
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !contentType.includes("text/event-stream")) {
      let message = `请求失败（${response.status}）`;
      if (contentType.includes("application/json")) {
        const payload = await response.json().catch(() => null);
        if (payload && payload.message) message = payload.message;
      }
      bubble.textContent = "";
      setAiBubbleError(wrap, bubble, message);
      return;
    }

    bubble.textContent = "";
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let separator;
      while ((separator = buffer.indexOf("\n\n")) >= 0) {
        const rawEvent = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        let event = "message";
        let dataStr = "";
        rawEvent.split("\n").forEach((line) => {
          if (line.startsWith("event:")) {
            event = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            dataStr += line.slice(5).trim();
          }
        });
        if (!dataStr) continue;
        let data;
        try {
          data = JSON.parse(dataStr);
        } catch {
          continue;
        }
        if (event === "delta" && data.text) {
          acc += data.text;
          setAiBubbleStreaming(bubble, acc);
          scrollAiMessages();
        } else if (event === "error") {
          bubble.textContent = "";
          setAiBubbleError(wrap, bubble, data.message || "AI 返回错误");
          return;
        }
      }
    }
    bubble.classList.remove("ai-cursor");
    if (acc.trim()) {
      setAiBubbleContent(bubble, acc);
      commitAssistant(acc);
    } else {
      setAiBubbleContent(bubble, "", "（AI 未返回内容，可重试或换个问法）");
    }
  } catch (error) {
    bubble.classList.remove("ai-cursor");
    if (error && error.name === "AbortError") {
      if (acc.trim()) {
        setAiBubbleContent(bubble, acc);
        commitAssistant(acc);
      } else {
        setAiBubbleContent(bubble, "", "（已停止）");
      }
    } else {
      bubble.textContent = "";
      setAiBubbleError(wrap, bubble, error && error.message ? error.message : "请求异常");
    }
  } finally {
    state.ai.busy = false;
    state.ai.controller = null;
    updateAiBusy();
    scrollAiMessages();
  }
}

function bindAiEvents() {
  selectors.ai.form.addEventListener("submit", submitAi);
  selectors.ai.input.addEventListener("input", autoGrowAiInput);
  selectors.ai.input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      submitAi(event);
    }
  });
  selectors.ai.stopButton.addEventListener("click", stopAi);
  selectors.ai.clearButton.addEventListener("click", clearAiConversation);
  renderAiQuickActions();
}

function bindEvents() {
  bindPageEvents("firmware");
  bindPageEvents("software");
  bindCalendarEvents();
  bindSettingsEvents();
  bindUpgradeEvents();
  bindPickerEvents();
  bindAiEvents();
  selectors.firmwareDetail.closeButton.addEventListener("click", closeFirmwareDetail);
  selectors.firmwareDetail.dialog.addEventListener("click", (event) => {
    if (event.target === selectors.firmwareDetail.dialog) {
      closeFirmwareDetail();
    }
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !selectors.firmwareDetail.dialog.hidden) {
      closeFirmwareDetail();
    }
  });
  window.addEventListener("hashchange", () => {
    setActivePage(resolvePageFromHash());
  });
}

async function init() {
  const auth = await fetchJson("/api/auth/session");
  state.adminAuthenticated = Boolean(auth.authenticated);
  updateAdminButton();
  await loadMeta();
  bindEvents();
  setDefaultEnableDate(selectors.firmware.form);
  setDefaultEnableDate(selectors.software.form);
  await Promise.all([
    loadRecords("firmware"),
    loadRecords("software"),
    loadCalendarRecords(),
    loadAiStatus().catch(() => {})
  ]);
  setActivePage(resolvePageFromHash());
}

init().catch((error) => {
  setStatus(state.activePage, error.message, true);
});
