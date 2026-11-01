export const CATEGORY_LABELS = { firmware: "固件", software: "软件" };
export const ARCHIVE_EXTENSIONS = new Set([".zip", ".rar", ".7z"]);

export const DEFAULT_OPTIONS = {
  models: ["未分类", "430L", "430X"],
  scenarios: ["未分类", "德令哈", "谷山梁", "肃州一期", "肃州二期", "威骏二期", "场内模块老化", "场内电池对拖", "场内环形对拖", "实验室", "其他"],
  gridModes: ["未分类", "跟网", "构网", "融合"],
  softwareNames: ["未分类", "单机上位机", "多机上位机", "自动化软件", "单机程序下载器", "参数表生成器"]
};

export function normalizeRecord(record) {
  const item = { ...record };
  if (item.category === "software") {
    return {
      ...item,
      category: "software",
      softwareName: item.softwareName || item.softwareType || "",
      version: item.version || "",
      model: item.model || item.pcsModel || "",
      scenario: item.scenario || "",
      enableDate: item.enableDate || item.releaseDate || "",
      description: item.description || ""
    };
  }

  const cpuVersions = {
    CPU1: item.cpu1Version || "",
    CPU2: item.cpu2Version || "",
    FPGA: item.fpgaVersion || "",
    ARM: item.armVersion || ""
  };
  if (item.firmwareType === "DSP_CPU1") cpuVersions.CPU1 = item.version || "";
  if (item.firmwareType === "DSP_CPU2") cpuVersions.CPU2 = item.version || "";
  if (item.firmwareType === "FPGA") cpuVersions.FPGA = item.version || "";
  if (item.firmwareType === "ARM") cpuVersions.ARM = item.version || "";

  return {
    ...item,
    category: "firmware",
    model: item.model || item.pcsModel || "",
    scenario: item.scenario || "",
    cpu1Version: cpuVersions.CPU1,
    cpu2Version: cpuVersions.CPU2,
    fpgaVersion: cpuVersions.FPGA,
    armVersion: cpuVersions.ARM,
    enableDate: item.enableDate || item.releaseDate || "",
    gridMode: item.gridMode || "",
    applicableSingleVersion: item.applicableSingleVersion || "",
    applicableMultiVersion: item.applicableMultiVersion || "",
    applicableAutomationVersion: item.applicableAutomationVersion || "",
    cpu1SourceSvn: item.cpu1SourceSvn || "",
    cpu2SourceSvn: item.cpu2SourceSvn || "",
    fpgaSourceSvn: item.fpgaSourceSvn || "",
    armSourceSvn: item.armSourceSvn || "",
    description: item.description || ""
  };
}

export function sortRecords(records) {
  return records.sort((a, b) => {
    const dateCompare = String(b.enableDate || "").localeCompare(String(a.enableDate || ""));
    return dateCompare || String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
  });
}

function requiredText(body, key, label) {
  const value = String(body[key] || "").trim();
  if (!value) throw new ValidationError(`请填写${label}`);
  return value;
}

export class ValidationError extends Error {}

function optionalText(body, key) {
  return String(body[key] || "").trim();
}

function validateDate(value, label, required = false) {
  if (!value) {
    if (required) throw new ValidationError(`请选择${label}`);
    return "";
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ValidationError(`${label}格式应为 YYYY-MM-DD`);
  return value;
}

function splitValues(value) {
  return String(value || "").split(",").map((part) => part.trim()).filter(Boolean);
}

function validateChoices(values, allowed, label) {
  if (!values.length) throw new ValidationError(`请至少选择一个${label}`);
  for (const value of values) {
    if (!allowed.includes(value)) throw new ValidationError(`${label}选项无效: ${value}`);
  }
}

export function buildRecordFromBody(body, existing, options) {
  const category = requiredText(body, "category", "一级分类");
  if (!CATEGORY_LABELS[category]) throw new ValidationError("一级分类无效");
  const base = { ...existing, category, description: optionalText(body, "description") };
  const models = splitValues(requiredText(body, "model", category === "firmware" ? "机型" : "适用机型"));
  const scenarios = splitValues(requiredText(body, "scenario", "适用场景"));
  validateChoices(models, options.models, category === "firmware" ? "机型" : "适用机型");
  validateChoices(scenarios, options.scenarios, "适用场景");

  if (category === "firmware") {
    const gridModes = splitValues(optionalText(body, "gridMode"));
    if (gridModes.length) validateChoices(gridModes, options.gridModes, "运行模式");
    return {
      ...base,
      model: models.join(","),
      scenario: scenarios.join(","),
      cpu1Version: requiredText(body, "cpu1Version", "CPU1 版本号"),
      cpu2Version: requiredText(body, "cpu2Version", "CPU2 版本号"),
      fpgaVersion: requiredText(body, "fpgaVersion", "FPGA 版本号"),
      armVersion: requiredText(body, "armVersion", "ARM 版本号"),
      cpu1SourceSvn: optionalText(body, "cpu1SourceSvn"),
      cpu2SourceSvn: optionalText(body, "cpu2SourceSvn"),
      fpgaSourceSvn: optionalText(body, "fpgaSourceSvn"),
      armSourceSvn: optionalText(body, "armSourceSvn"),
      enableDate: validateDate(optionalText(body, "enableDate"), "启用日期"),
      gridMode: gridModes.join(","),
      applicableSingleVersion: optionalText(body, "applicableSingleVersion"),
      applicableMultiVersion: optionalText(body, "applicableMultiVersion"),
      applicableAutomationVersion: optionalText(body, "applicableAutomationVersion"),
      softwareName: "",
      version: "",
      sourceSvn: ""
    };
  }

  const softwareName = requiredText(body, "softwareName", "软件名称");
  if (!options.softwareNames.includes(softwareName)) throw new ValidationError("软件名称无效");
  return {
    ...base,
    softwareName,
    version: requiredText(body, "version", "版本号"),
    model: models.join(","),
    scenario: scenarios.join(","),
    enableDate: validateDate(optionalText(body, "enableDate"), "启用日期", true),
    cpu1Version: "",
    cpu2Version: "",
    fpgaVersion: "",
    armVersion: "",
    gridMode: "",
    applicableSingleVersion: "",
    applicableMultiVersion: "",
    applicableAutomationVersion: "",
    cpu1SourceSvn: "",
    cpu2SourceSvn: "",
    fpgaSourceSvn: "",
    armSourceSvn: "",
    sourceSvn: optionalText(body, "sourceSvn")
  };
}

export function buildObjectKey(record, originalName) {
  const safe = (value, fallback = "未命名") => String(value || "").trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/\s+/g, "_").replace(/\.+$/g, "").slice(0, 80) || fallback;
  const parsed = String(originalName || "package.zip").match(/^(.*?)(\.[^.\\/]+)?$/);
  const stem = safe(parsed?.[1], "package");
  const ext = String(parsed?.[2] || "").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "").slice(0, 20);
  const fileName = `${stem}${ext}`;
  const base = record.category === "software"
    ? ["software", safe(record.softwareName), safe(record.model), safe(record.scenario), `${safe(record.version)}_${safe(record.enableDate)}`]
    : ["firmware", safe(record.model), safe(record.scenario), [record.cpu1Version, record.cpu2Version, record.fpgaVersion, record.armVersion, record.enableDate].filter(Boolean).map(safe).join("_") || "versions"];
  return [...base, safe(record.id, "record"), fileName].join("/");
}

export function filterRecords(records, query) {
  const filters = {
    category: (query.get("category") || "").trim(),
    model: (query.get("model") || query.get("pcsModel") || "").trim().toLowerCase(),
    gridMode: (query.get("gridMode") || "").trim(),
    softwareName: (query.get("softwareName") || query.get("softwareType") || "").trim(),
    version: (query.get("version") || "").trim().toLowerCase(),
    keyword: (query.get("keyword") || "").trim().toLowerCase()
  };
  return sortRecords(records.filter((item) => {
    if (filters.category && item.category !== filters.category) return false;
    if (filters.model && !splitValues(item.model).some((value) => value.toLowerCase() === filters.model)) return false;
    if (filters.gridMode && !splitValues(item.gridMode).includes(filters.gridMode)) return false;
    if (filters.softwareName && item.softwareName !== filters.softwareName) return false;
    if (filters.version && ![item.version, item.cpu1Version, item.cpu2Version, item.fpgaVersion, item.armVersion].join(" ").toLowerCase().includes(filters.version)) return false;
    if (filters.keyword) {
      const haystack = [CATEGORY_LABELS[item.category], item.model, item.scenario, item.cpu1Version, item.cpu2Version, item.fpgaVersion, item.armVersion, item.gridMode, item.applicableSingleVersion, item.applicableMultiVersion, item.applicableAutomationVersion, item.softwareName, item.version, item.enableDate, item.fileName, item.originalFileName, item.description].join(" ").toLowerCase();
      if (!haystack.includes(filters.keyword)) return false;
    }
    return true;
  }));
}

export function computeOptionChanges(oldList, newList) {
  const renames = {};
  const migrated = {};
  const oldTrim = oldList.map((value) => String(value ?? "").trim()).filter(Boolean);
  const newTrim = newList.map((value) => String(value ?? "").trim()).filter(Boolean);
  const newSet = new Set(newTrim);
  const defaultValue = newTrim[0] || "未分类";
  if (oldTrim.length === newTrim.length) {
    oldTrim.forEach((value, index) => {
      if (value !== newTrim[index]) renames[value] = newTrim[index];
    });
  }
  oldTrim.forEach((value) => {
    if (!newSet.has(value) && !renames[value]) migrated[value] = defaultValue;
  });
  return { ...renames, ...migrated };
}

export function applyOptionChanges(records, oldOptions, newOptions) {
  let affectedRecords = 0;
  const fields = [
    ["model", "models"], ["scenario", "scenarios"], ["gridMode", "gridModes"], ["softwareName", "softwareNames"]
  ];
  for (const [field, optionKey] of fields) {
    const mapping = computeOptionChanges(oldOptions[optionKey], newOptions[optionKey]);
    if (!Object.keys(mapping).length) continue;
    for (const record of records) {
      const before = record[field];
      const parts = splitValues(before);
      const after = parts.map((part) => mapping[part] ?? part).filter(Boolean).join(",");
      if (after !== before) {
        record[field] = after;
        affectedRecords += 1;
      }
    }
  }
  return affectedRecords;
}

export function normalizeAiMessages(incoming) {
  if (!Array.isArray(incoming)) return [];
  const cleaned = [];
  for (const item of incoming) {
    const role = item?.role === "assistant" ? "assistant" : "user";
    const content = String(item?.content || "").trim();
    if (!content) continue;
    const last = cleaned.at(-1);
    if (last?.role === role) last.content = `${last.content}\n${content}`.slice(0, 4000);
    else cleaned.push({ role, content: content.slice(0, 4000) });
    if (cleaned.length >= 20) break;
  }
  while (cleaned.length && cleaned[0].role !== "user") cleaned.shift();
  return cleaned;
}

export function buildAiSystemPrompt(records, options) {
  const compact = records.map((record) => record.category === "software" ? {
    id: record.id, 类别: "软件", 软件名称: record.softwareName, 版本号: record.version,
    适用机型: record.model, 适用场景: record.scenario, 启用日期: record.enableDate,
    说明: record.description, 文件名: record.originalFileName || record.fileName, 源码SVN: record.sourceSvn
  } : {
    id: record.id, 类别: "固件", 适用机型: record.model, 适用场景: record.scenario,
    CPU1: record.cpu1Version, CPU2: record.cpu2Version, FPGA: record.fpgaVersion, ARM: record.armVersion,
    运行模式: record.gridMode, 启用日期: record.enableDate,
    适用单机版本: record.applicableSingleVersion, 适用多机版本: record.applicableMultiVersion,
    适用自动化版本: record.applicableAutomationVersion, 说明: record.description,
    文件名: record.originalFileName || record.fileName
  });
  return [
    "你是「固件与软件包管理系统」内置的 AI 助手，专门帮助用户检索、查询、对比和总结系统中已登记的固件与软件记录。",
    "下方 <repository> 标签内是系统当前的全部记录。请严格依据这些记录作答，不要编造不存在的机型、版本或记录。",
    "<options> 标签内是下拉字段的完整可选项。作答使用中文；涉及最新版本时以启用日期为准；优先使用要点列表。",
    "用户请求下载文件时，单独一行输出 [[DOWNLOAD id=\"<记录id>\" name=\"<显示名>\"]]。",
    `<repository>\n${JSON.stringify(compact)}\n</repository>`,
    `<options>\n${JSON.stringify(options)}\n</options>`
  ].join("\n\n");
}

export function escapeXml(text) {
  return String(text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
