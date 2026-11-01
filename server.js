const crypto = require("crypto");
const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const AdmZip = require("adm-zip");
const express = require("express");
const multer = require("multer");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";

const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, "data");
const UPLOAD_ROOT = path.join(ROOT_DIR, "uploads");
const FIRMWARE_UPLOAD_ROOT = path.join(UPLOAD_ROOT, "firmware");
const SOFTWARE_UPLOAD_ROOT = path.join(UPLOAD_ROOT, "software");
const DB_FILE = path.join(DATA_DIR, "firmware.json");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const UPGRADE_ROOT = path.join(DATA_DIR, "upgrades");
const UPGRADE_STATUS_FILE = path.join(UPGRADE_ROOT, "status.json");
const OPTIONS_FILE = path.join(DATA_DIR, "options.json");
const LOG_FILE = path.join(DATA_DIR, "server.log");
const AI_WORKSPACE_DIR = path.join(ROOT_DIR, "ai_workspace");
const AI_CONFIG_FILE = path.join(AI_WORKSPACE_DIR, "ai_config.json");
const AI_DEFAULT_MODEL = "claude-sonnet-4-5-20250929";
const AI_DEFAULT_MAX_TOKENS = 2048;
const AI_MAX_MESSAGE_TURNS = 20;
const AI_MAX_MESSAGE_CHARS = 4000;

function logLine(message) {
  try {
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${message}\n`, "utf8");
  } catch {
    // 日志失败不应影响请求
  }
}

const CATEGORY_LABELS = {
  firmware: "固件",
  software: "软件"
};
const ARCHIVE_EXTENSIONS = new Set([".zip", ".rar", ".7z"]);
const UPGRADE_PACKAGE_EXTENSIONS = new Set([".zip"]);
const PRESERVED_UPGRADE_ENTRIES = new Set(["data", "uploads", "node_modules", ".git", ".env"]);

const DEFAULT_OPTIONS = {
  models: ["未分类", "430L", "430X"],
  scenarios: ["未分类", "德令哈", "谷山梁", "肃州一期", "肃州二期", "威骏二期", "场内模块老化", "场内电池对拖", "场内环形对拖", "实验室", "其他"],
  gridModes: ["未分类", "跟网", "构网", "融合"],
  softwareNames: ["未分类", "单机上位机", "多机上位机", "自动化软件", "单机程序下载器", "参数表生成器"]
};

function loadOptions() {
  if (!fs.existsSync(OPTIONS_FILE)) {
    fs.writeFileSync(OPTIONS_FILE, JSON.stringify(DEFAULT_OPTIONS, null, 2), "utf8");
    return { ...DEFAULT_OPTIONS };
  }
  try {
    const content = fs.readFileSync(OPTIONS_FILE, "utf8");
    const parsed = JSON.parse(content);
    return { ...DEFAULT_OPTIONS, ...parsed };
  } catch {
    return { ...DEFAULT_OPTIONS };
  }
}

let options = loadOptions();

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
fs.mkdirSync(FIRMWARE_UPLOAD_ROOT, { recursive: true });
fs.mkdirSync(SOFTWARE_UPLOAD_ROOT, { recursive: true });
fs.mkdirSync(UPGRADE_ROOT, { recursive: true });
fs.mkdirSync(AI_WORKSPACE_DIR, { recursive: true });

app.use(express.json());
app.use(express.static(PUBLIC_DIR));

app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on("finish", () => {
    logLine(`${req.method} ${req.originalUrl} -> ${res.statusCode} ${Date.now() - startedAt}ms`);
  });
  next();
});

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    if (file?.originalname) {
      file.originalname = decodeMaybeUtf8FileName(file.originalname);
    }
    cb(null, true);
  },
  limits: {
    fileSize: 1024 * 1024 * 1024
  }
});

function readDbFrom(file) {
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, "utf8").trim();
  if (!raw) return [];
  return JSON.parse(raw).map(normalizeRecord);
}

function readDb() {
  try {
    return readDbFrom(DB_FILE) ?? [];
  } catch (error) {
    console.error(`firmware.json 解析失败，尝试备份：${error.message}`);
    try {
      return readDbFrom(`${DB_FILE}.bak`) ?? [];
    } catch {
      return [];
    }
  }
}

function writeDb(records) {
  const payload = JSON.stringify(records.map(normalizeRecord), null, 2);
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, payload, "utf8");
  try {
    if (fs.existsSync(DB_FILE)) fs.copyFileSync(DB_FILE, `${DB_FILE}.bak`);
  } catch (error) {
    console.error(`备份 firmware.json 失败：${error.message}`);
  }
  fs.renameSync(tmp, DB_FILE);
}

function normalizeRecord(record) {
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

function sanitizeSegment(value, fallback = "未命名") {
  const normalized = String(value || "")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/\.+$/g, "")
    .slice(0, 80);

  return normalized || fallback;
}

function sanitizeFileName(fileName) {
  const parsed = path.parse(fileName || "package.zip");
  const name = sanitizeSegment(parsed.name, "package");
  const ext = parsed.ext.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "").slice(0, 20);
  return `${name}${ext}`;
}

function decodeMaybeUtf8FileName(fileName) {
  const value = String(fileName || "");
  if (!value) return value;

  const decoded = Buffer.from(value, "latin1").toString("utf8");
  if (!decoded || decoded === value || decoded.includes("\uFFFD")) {
    return value;
  }

  const hasCjk = /[\u3400-\u9fff\uf900-\ufaff]/;
  const hasLatin1OrControl = /[\u0080-\u00ff]/;
  return hasLatin1OrControl.test(value) && hasCjk.test(decoded) ? decoded : value;
}

function normalizeUploadedFile(file) {
  if (file?.originalname) {
    file.originalname = decodeMaybeUtf8FileName(file.originalname);
  }
  return file;
}

function ensureInside(baseDir, targetPath) {
  const relative = path.relative(baseDir, targetPath);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function requiredText(body, key, label) {
  const value = String(body[key] || "").trim();
  if (!value) {
    throw new Error(`请填写${label}`);
  }
  return value;
}

function optionalText(body, key) {
  return String(body[key] || "").trim();
}

function validateDate(value, label, required = false) {
  if (!value) {
    if (required) {
      throw new Error(`请选择${label}`);
    }
    return "";
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label}格式应为 YYYY-MM-DD`);
  }
  return value;
}

function validateArchiveFile(file) {
  const ext = path.extname(file.originalname || "").toLowerCase();
  if (!ARCHIVE_EXTENSIONS.has(ext)) {
    throw new Error("请上传 .zip、.rar 或 .7z 压缩包");
  }
}

function getUploadCategoryRoot(category) {
  return category === "software" ? SOFTWARE_UPLOAD_ROOT : FIRMWARE_UPLOAD_ROOT;
}

function getUploadedFile(req) {
  return normalizeUploadedFile(req.files?.packageFile?.[0] || req.files?.firmwareFile?.[0] || null);
}

function buildRecordFromBody(body, existing = {}) {
  const category = requiredText(body, "category", "一级分类");
  if (!CATEGORY_LABELS[category]) {
    throw new Error("一级分类无效");
  }

  const base = {
    ...existing,
    category,
    description: optionalText(body, "description")
  };

  if (category === "firmware") {
    const modelInput = requiredText(body, "model", "机型");
    const gridModeInput = optionalText(body, "gridMode");
    const gridModes = gridModeInput.split(",").map((g) => g.trim()).filter(Boolean);
    gridModes.forEach((g) => {
      if (!options.gridModes.includes(g)) {
        throw new Error(`运行模式选项无效: ${g}`);
      }
    });
    const models = modelInput.split(",").map((m) => m.trim()).filter(Boolean);
    if (models.length === 0) {
      throw new Error("请至少选择一个机型");
    }
    models.forEach((m) => {
      if (!options.models.includes(m)) {
        throw new Error(`机型选项无效: ${m}`);
      }
    });
    const scenario = requiredText(body, "scenario", "使用场景");
    const scenarios = scenario.split(",").map((s) => s.trim()).filter(Boolean);
    if (scenarios.length === 0) {
      throw new Error("请至少选择一个使用场景");
    }
    scenarios.forEach((s) => {
      if (!options.scenarios.includes(s)) {
        throw new Error(`使用场景选项无效: ${s}`);
      }
    });

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
  if (!options.softwareNames.includes(softwareName)) {
    throw new Error("软件名称无效");
  }
  const modelInput = requiredText(body, "model", "适用机型");
  const models = modelInput.split(",").map((m) => m.trim()).filter(Boolean);
  if (models.length === 0) {
    throw new Error("请至少选择一个适用机型");
  }
  models.forEach((m) => {
    if (!options.models.includes(m)) {
      throw new Error(`适用机型选项无效: ${m}`);
    }
  });
  const scenario = requiredText(body, "scenario", "适用场景");
  const scenarios = scenario.split(",").map((s) => s.trim()).filter(Boolean);
  if (scenarios.length === 0) {
    throw new Error("请至少选择一个适用场景");
  }
  scenarios.forEach((s) => {
    if (!options.scenarios.includes(s)) {
      throw new Error(`适用场景选项无效: ${s}`);
    }
  });

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

function buildStoragePath(record, originalName) {
  const categoryRoot = getUploadCategoryRoot(record.category);
  const fileName = sanitizeFileName(originalName);
  let finalDir;

  if (record.category === "firmware") {
    const versionDir = [
      record.cpu1Version,
      record.cpu2Version,
      record.fpgaVersion,
      record.armVersion,
      record.enableDate
    ].filter(Boolean).map((value) => sanitizeSegment(value)).join("_");
    finalDir = path.join(
      categoryRoot,
      sanitizeSegment(record.model),
      sanitizeSegment(record.scenario),
      versionDir || "versions"
    );
  } else {
    const versionDir = `${sanitizeSegment(record.version)}_${sanitizeSegment(record.enableDate)}`;
    finalDir = path.join(
      categoryRoot,
      sanitizeSegment(record.softwareName),
      sanitizeSegment(record.model),
      sanitizeSegment(record.scenario),
      versionDir
    );
  }

  const finalPath = path.join(finalDir, fileName);
  if (!ensureInside(UPLOAD_ROOT, finalPath)) {
    throw new Error("文件存储路径无效");
  }

  return {
    finalDir,
    finalPath,
    relativePath: path.relative(UPLOAD_ROOT, finalPath).replace(/\\/g, "/")
  };
}

function writeUploadedFile(record, file) {
  normalizeUploadedFile(file);
  validateArchiveFile(file);
  const storage = buildStoragePath(record, file.originalname);
  fs.mkdirSync(storage.finalDir, { recursive: true });

  let targetPath = storage.finalPath;
  let relativePath = storage.relativePath;
  if (fs.existsSync(targetPath)) {
    const parsed = path.parse(targetPath);
    const suffix = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    targetPath = path.join(parsed.dir, `${parsed.name}_${suffix}${parsed.ext}`);
    relativePath = path.relative(UPLOAD_ROOT, targetPath).replace(/\\/g, "/");
  }

  fs.writeFileSync(targetPath, file.buffer);
  return {
    fileName: sanitizeFileName(file.originalname),
    originalFileName: file.originalname,
    fileSize: file.size,
    mimeType: file.mimetype || "application/octet-stream",
    relativePath
  };
}

function removeStoredFile(record) {
  if (!record?.relativePath) return;
  const absolutePath = resolveStoredFilePath(record);
  if (ensureInside(UPLOAD_ROOT, absolutePath) && fs.existsSync(absolutePath)) {
    fs.unlinkSync(absolutePath);
  }
}

function resolveStoredFilePath(record) {
  if (!record?.relativePath) return "";
  const directPath = path.join(UPLOAD_ROOT, record.relativePath);
  if (ensureInside(UPLOAD_ROOT, directPath) && fs.existsSync(directPath)) {
    return directPath;
  }

  const legacyPaths = [
    path.join(ROOT_DIR, record.relativePath),
    path.join(FIRMWARE_UPLOAD_ROOT, record.relativePath),
    path.join(SOFTWARE_UPLOAD_ROOT, record.relativePath)
  ];
  return legacyPaths.find((candidate) => fs.existsSync(candidate)) || directPath;
}

function sortRecords(records) {
  return records.sort((a, b) => {
    const dateCompare = String(b.enableDate || "").localeCompare(String(a.enableDate || ""));
    if (dateCompare !== 0) return dateCompare;
    return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
  });
}

function readUpgradeStatus() {
  if (!fs.existsSync(UPGRADE_STATUS_FILE)) {
    return { running: false, ok: false, message: "尚未执行升级", updatedAt: "" };
  }
  try {
    return JSON.parse(fs.readFileSync(UPGRADE_STATUS_FILE, "utf8"));
  } catch (_error) {
    return { running: false, ok: false, message: "升级状态文件读取失败", updatedAt: new Date().toISOString() };
  }
}

function writeUpgradeStatus(status) {
  const nextStatus = { ...readUpgradeStatus(), ...status, updatedAt: new Date().toISOString() };
  fs.writeFileSync(UPGRADE_STATUS_FILE, JSON.stringify(nextStatus, null, 2), "utf8");
  return nextStatus;
}

function validateUpgradeFile(file) {
  if (!file) throw new Error("请选择网站升级压缩包");
  const ext = path.extname(file.originalname || "").toLowerCase();
  if (!UPGRADE_PACKAGE_EXTENSIONS.has(ext)) throw new Error("网站升级包仅支持 .zip 格式");
}

function validateZipEntries(zip) {
  const entries = zip.getEntries();
  if (!entries.length) throw new Error("升级包为空");
  entries.forEach((entry) => {
    const entryName = String(entry.entryName || "").replace(/\\/g, "/");
    if (!entryName || entryName.includes("\u0000") || entryName.startsWith("/") || /^[a-zA-Z]:/.test(entryName)) {
      throw new Error(`升级包中存在非法路径：${entry.entryName}`);
    }
    const parts = entryName.split("/").filter(Boolean);
    if (!parts.length || parts.some((part) => part === "." || part === "..")) {
      throw new Error(`升级包中存在非法路径：${entry.entryName}`);
    }
  });
}

function looksLikeProjectRoot(directory) {
  return fs.existsSync(path.join(directory, "package.json"))
    && fs.existsSync(path.join(directory, "server.js"))
    && fs.existsSync(path.join(directory, "public"));
}

function findUpgradeProjectRoot(extractDir) {
  if (looksLikeProjectRoot(extractDir)) return extractDir;
  const children = fs.readdirSync(extractDir, { withFileTypes: true });
  for (const child of children) {
    if (!child.isDirectory()) continue;
    const candidate = path.join(extractDir, child.name);
    if (looksLikeProjectRoot(candidate)) return candidate;
  }
  throw new Error("升级包格式不正确：未找到 package.json、server.js 和 public 目录");
}

function isPreservedUpgradeEntry(relativePath) {
  const topLevel = String(relativePath || "").replace(/\\/g, "/").split("/")[0];
  return PRESERVED_UPGRADE_ENTRIES.has(topLevel) || /^server.*\.log$/i.test(topLevel);
}

function copyUpgradeProgramFiles(sourceRoot) {
  const copiedEntries = [];
  const preservedEntries = [];
  fs.readdirSync(sourceRoot, { withFileTypes: true }).forEach((entry) => {
    const sourcePath = path.join(sourceRoot, entry.name);
    const targetPath = path.join(ROOT_DIR, entry.name);
    if (isPreservedUpgradeEntry(entry.name)) {
      preservedEntries.push(entry.name);
      return;
    }
    if (!ensureInside(ROOT_DIR, targetPath)) throw new Error(`目标路径非法：${entry.name}`);
    if (entry.isDirectory()) {
      fs.rmSync(targetPath, { recursive: true, force: true });
      fs.cpSync(sourcePath, targetPath, { recursive: true, force: true });
    } else if (entry.isFile()) {
      fs.copyFileSync(sourcePath, targetPath);
    } else {
      preservedEntries.push(entry.name);
      return;
    }
    copiedEntries.push(entry.name);
  });
  return { copiedEntries, preservedEntries };
}

function findNpmCliPath() {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || "";
}

function runNpmInstall() {
  const npmCliPath = findNpmCliPath();
  if (npmCliPath) {
    childProcess.execFileSync(process.execPath, [npmCliPath, "install", "--omit=dev"], {
      cwd: ROOT_DIR,
      timeout: 120000,
      stdio: "pipe"
    });
    return `已通过 ${path.basename(process.execPath)} ${npmCliPath} 安装依赖`;
  }
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  childProcess.execFileSync(npmCommand, ["install", "--omit=dev"], {
    cwd: ROOT_DIR,
    timeout: 120000,
    stdio: "pipe",
    shell: process.platform === "win32"
  });
  return `已通过 ${npmCommand} 安装依赖`;
}

function installProductionDependencies(copiedEntries) {
  const shouldInstall = copiedEntries.includes("package.json") || copiedEntries.includes("package-lock.json");
  if (!shouldInstall) return { skipped: true, message: "依赖文件未变化，已跳过 npm install" };
  try {
    return { skipped: false, message: runNpmInstall() };
  } catch (error) {
    const detail = [error.message, error.stderr?.toString(), error.stdout?.toString()].filter(Boolean).join("\n").trim();
    throw new Error(`依赖安装失败：${detail || "未知错误"}`);
  }
}

function performWebsiteUpgrade(file) {
  normalizeUploadedFile(file);
  validateUpgradeFile(file);
  const upgradeId = `${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${crypto.randomUUID()}`;
  const workDir = path.join(UPGRADE_ROOT, upgradeId);
  const packagePath = path.join(workDir, sanitizeFileName(file.originalname || "upgrade.zip"));
  const extractDir = path.join(workDir, "extract");
  if (!ensureInside(UPGRADE_ROOT, workDir)) throw new Error("升级工作目录非法");
  writeUpgradeStatus({ running: true, ok: false, stage: "upload", message: "正在保存升级包", fileName: file.originalname || "", startedAt: new Date().toISOString(), finishedAt: "" });
  try {
    fs.mkdirSync(extractDir, { recursive: true });
    fs.writeFileSync(packagePath, file.buffer);
    writeUpgradeStatus({ stage: "extract", message: "正在解压并校验升级包" });
    const zip = new AdmZip(packagePath);
    validateZipEntries(zip);
    zip.extractAllTo(extractDir, true);
    const sourceRoot = findUpgradeProjectRoot(extractDir);
    writeUpgradeStatus({ stage: "copy", message: "正在替换程序文件" });
    const copyResult = copyUpgradeProgramFiles(sourceRoot);
    writeUpgradeStatus({ stage: "install", message: "正在检查依赖" });
    const installResult = installProductionDependencies(copyResult.copiedEntries);
    const restartRequired = copyResult.copiedEntries.some((entry) => ["server.js", "package.json", "package-lock.json"].includes(entry));
    return writeUpgradeStatus({
      running: false,
      ok: true,
      stage: "done",
      message: restartRequired ? "升级完成，重启服务后后端代码完全生效" : "升级完成",
      finishedAt: new Date().toISOString(),
      copiedEntries: copyResult.copiedEntries,
      preservedEntries: copyResult.preservedEntries,
      installResult,
      restartRequired
    });
  } catch (error) {
    error.status = writeUpgradeStatus({ running: false, ok: false, stage: "failed", message: error.message || "升级失败", finishedAt: new Date().toISOString() });
    throw error;
  }
}

app.get("/api/meta", (_req, res) => {
  const records = readDb();
  res.json({
    categories: CATEGORY_LABELS,
    firmwareModels: options.models,
    gridModes: options.gridModes,
    scenarios: options.scenarios,
    softwareNames: options.softwareNames,
    archiveExtensions: Array.from(ARCHIVE_EXTENSIONS),
    storageRoot: "固件：uploads/firmware；软件：uploads/software",
    storageRoots: {
      firmware: "uploads/firmware",
      software: "uploads/software"
    },
    total: records.length
  });
});

app.get("/api/firmwares", (req, res) => {
  const filters = {
    category: String(req.query.category || "").trim(),
    model: String(req.query.model || req.query.pcsModel || "").trim().toLowerCase(),
    gridMode: String(req.query.gridMode || "").trim(),
    softwareName: String(req.query.softwareName || req.query.softwareType || "").trim(),
    version: String(req.query.version || "").trim().toLowerCase(),
    keyword: String(req.query.keyword || "").trim().toLowerCase()
  };

  const records = readDb().filter((item) => {
    if (filters.category && item.category !== filters.category) return false;
    if (filters.model) {
      const modelList = String(item.model || "").split(",").map((m) => m.trim().toLowerCase()).filter(Boolean);
      if (!modelList.includes(filters.model)) return false;
    }
    if (filters.gridMode) {
      const gridModeList = String(item.gridMode || "").split(",").map((g) => g.trim()).filter(Boolean);
      if (!gridModeList.includes(filters.gridMode)) return false;
    }
    if (filters.softwareName && item.softwareName !== filters.softwareName) return false;
    if (filters.version) {
      const versions = [item.version, item.cpu1Version, item.cpu2Version, item.fpgaVersion, item.armVersion]
        .join(" ")
        .toLowerCase();
      if (!versions.includes(filters.version)) return false;
    }
    if (filters.keyword) {
      const haystack = [
        CATEGORY_LABELS[item.category],
        item.model,
        item.scenario,
        item.cpu1Version,
        item.cpu2Version,
        item.fpgaVersion,
        item.armVersion,
        item.gridMode,
        item.applicableSingleVersion,
        item.applicableMultiVersion,
        item.applicableAutomationVersion,
        item.softwareName,
        item.version,
        item.enableDate,
        item.fileName,
        item.originalFileName,
        item.description
      ].join(" ").toLowerCase();
      if (!haystack.includes(filters.keyword)) return false;
    }
    return true;
  });

  res.json(sortRecords(records));
});

app.post("/api/firmwares", upload.fields([{ name: "packageFile", maxCount: 1 }, { name: "firmwareFile", maxCount: 1 }]), (req, res) => {
  try {
    const file = getUploadedFile(req);
    if (!file) {
      return res.status(400).json({ message: "请选择要上传的压缩包" });
    }

    const record = {
      id: crypto.randomUUID(),
      ...buildRecordFromBody(req.body),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    Object.assign(record, writeUploadedFile(record, file));

    const records = readDb();
    records.push(record);
    writeDb(sortRecords(records));

    res.status(201).json(record);
  } catch (error) {
    res.status(400).json({ message: error.message || "上传失败" });
  }
});

app.put("/api/firmwares/:id", upload.fields([{ name: "packageFile", maxCount: 1 }, { name: "firmwareFile", maxCount: 1 }]), (req, res) => {
  try {
    const records = readDb();
    const index = records.findIndex((item) => item.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ message: "未找到记录" });
    }

    const existing = records[index];
    const file = getUploadedFile(req);
    const updated = {
      ...buildRecordFromBody(req.body, existing),
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString()
    };

    if (file) {
      Object.assign(updated, writeUploadedFile(updated, file));
      removeStoredFile(existing);
    } else {
      Object.assign(updated, {
        fileName: existing.fileName,
        originalFileName: existing.originalFileName,
        fileSize: existing.fileSize,
        mimeType: existing.mimeType,
        relativePath: existing.relativePath
      });
    }

    records[index] = updated;
    writeDb(sortRecords(records));
    res.json(updated);
  } catch (error) {
    res.status(400).json({ message: error.message || "保存失败" });
  }
});

app.get("/api/firmwares/:id", (req, res) => {
  const record = readDb().find((item) => item.id === req.params.id);
  if (!record) {
    return res.status(404).json({ message: "未找到记录" });
  }

  res.json(record);
});

app.get("/api/firmwares/:id/download", (req, res) => {
  const record = readDb().find((item) => item.id === req.params.id);
  if (!record) {
    return res.status(404).json({ message: "未找到记录" });
  }

  const absolutePath = resolveStoredFilePath(record);
  if (!ensureInside(UPLOAD_ROOT, absolutePath) || !fs.existsSync(absolutePath)) {
    return res.status(404).json({ message: "服务器文件不存在" });
  }

  res.download(
    absolutePath,
    record.originalFileName || record.fileName,
    { dotfiles: "allow" },
    (error) => {
      if (!error || res.headersSent) {
        return;
      }

      res.status(error.statusCode || 500).json({
        message: error.statusCode === 404 ? "服务器文件不存在" : "文件下载失败"
      });
    }
  );
});

app.delete("/api/firmwares/:id", (req, res) => {
  const records = readDb();
  const index = records.findIndex((item) => item.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ message: "未找到记录" });
  }

  const [record] = records.splice(index, 1);
  removeStoredFile(record);

  writeDb(records);
  res.json({ ok: true });
});

app.get("/api/upgrade/status", (_req, res) => {
  res.json(readUpgradeStatus());
});

app.get("/api/options", (_req, res) => {
  res.json(options);
});

function computeOptionChanges(oldList, newList) {
  const renames = {};
  const migrated = {};
  const oldTrim = oldList.map((v) => String(v ?? "").trim()).filter(Boolean);
  const newTrim = newList.map((v) => String(v ?? "").trim()).filter(Boolean);
  const newSet = new Set(newTrim);
  const defaultVal = newTrim[0] || "未分类";

  // 仅在长度不变时按索引视为重命名，避免“删除某项导致后续整体错位”被误判成重命名
  if (oldTrim.length === newTrim.length) {
    for (let i = 0; i < oldTrim.length; i += 1) {
      if (oldTrim[i] !== newTrim[i]) {
        renames[oldTrim[i]] = newTrim[i];
      }
    }
  }

  // 被删除的旧值（新列表里没有了、也不是被改名）其记录引用迁移到首项（未分类）
  oldTrim.forEach((value) => {
    if (!newSet.has(value) && !renames[value]) {
      migrated[value] = defaultVal;
    }
  });

  return { renames, migrated };
}

function applyCommaMap(value, mapping) {
  if (!value) return value;
  const items = String(value).split(",").map((s) => s.trim());
  let changed = false;
  const next = items.map((s) => {
    if (mapping[s] !== undefined && mapping[s] !== s) {
      changed = true;
      return mapping[s];
    }
    return s;
  });
  return changed ? next.filter(Boolean).join(",") : value;
}

function applyOptionChanges(specs) {
  let records = null;
  let affected = 0;
  specs.forEach(({ field, oldList, newList }) => {
    const { renames, migrated } = computeOptionChanges(oldList, newList);
    const mapping = { ...renames, ...migrated };
    if (Object.keys(mapping).length === 0) return;
    if (!records) records = readDb();
    records.forEach((record) => {
      const before = record[field];
      const after = applyCommaMap(before, mapping);
      if (after !== before) {
        record[field] = after;
        affected += 1;
      }
    });
  });
  if (records && affected > 0) writeDb(records);
  return affected;
}

app.put("/api/options", (req, res) => {
  try {
    const body = req.body || {};
    const models = Array.isArray(body.models) ? body.models : options.models;
    const scenarios = Array.isArray(body.scenarios) ? body.scenarios : options.scenarios;
    const gridModes = Array.isArray(body.gridModes) ? body.gridModes : options.gridModes;
    const softwareNames = Array.isArray(body.softwareNames) ? body.softwareNames : options.softwareNames;

    const newOptions = {
      models: models.filter(Boolean).map((m) => String(m).trim()),
      scenarios: scenarios.filter(Boolean).map((s) => String(s).trim()),
      gridModes: gridModes.filter(Boolean).map((g) => String(g).trim()),
      softwareNames: softwareNames.filter(Boolean).map((n) => String(n).trim())
    };

    const affectedRecords = applyOptionChanges([
      { field: "model", oldList: options.models, newList: newOptions.models },
      { field: "scenario", oldList: options.scenarios, newList: newOptions.scenarios },
      { field: "gridMode", oldList: options.gridModes, newList: newOptions.gridModes },
      { field: "softwareName", oldList: options.softwareNames, newList: newOptions.softwareNames }
    ]);

    fs.writeFileSync(OPTIONS_FILE, JSON.stringify(newOptions, null, 2), "utf8");
    options = newOptions;
    res.json({ ok: true, options, changes: { affectedRecords } });
  } catch (error) {
    res.status(400).json({ ok: false, message: error.message });
  }
});

app.post("/api/restart", (_req, res) => {
  res.json({ ok: true, message: "服务器正在重启..." });
  setTimeout(() => {
    const nodePath = process.execPath;
    const scriptPath = process.argv[1];
    const args = process.argv.slice(2);
    const child = childProcess.spawn(nodePath, [scriptPath, ...args], {
      detached: true,
      stdio: "ignore"
    });
    child.unref();
    process.exit(0);
  }, 500);
});

app.post("/api/upgrade", upload.single("upgradePackage"), (req, res) => {
  try {
    const status = performWebsiteUpgrade(req.file);
    res.json(status);
  } catch (error) {
    res.status(400).json(error.status || {
      running: false,
      ok: false,
      message: error.message || "升级失败",
      updatedAt: new Date().toISOString()
    });
  }
});

function escapeXml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const DOCX_CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
  + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  + '<Default Extension="xml" ContentType="application/xml"/>'
  + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
  + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
  + '</Types>';

const DOCX_ROOT_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
  + '</Relationships>';

const DOCX_DOC_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
  + '</Relationships>';

const DOCX_STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
  + '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
  + '<w:docDefaults><w:rPrDefault><w:rPr>'
  + '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="宋体" w:cs="Calibri"/>'
  + '<w:sz w:val="22"/><w:szCs w:val="22"/>'
  + '</w:rPr></w:rPrDefault>'
  + '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>'
  + '</w:docDefaults></w:styles>';

function docxInlineRuns(text, inherited) {
  const runs = [];
  const re = /(\*\*([^*]+)\*\*)|(\*([^*\n]+)\*)|(`([^`]+)`)/g;
  let last = 0;
  let m = null;
  const pushRun = (raw, opts) => {
    const t = raw == null ? "" : String(raw);
    if (!t) return;
    const rPr = [];
    if (opts && opts.bold) rPr.push("<w:b/>");
    if (opts && opts.italic) rPr.push("<w:i/>");
    if (opts && opts.code) rPr.push('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>');
    const rPrXml = rPr.length ? `<w:rPr>${rPr.join("")}</w:rPr>` : "";
    runs.push(`<w:r>${rPrXml}<w:t xml:space="preserve">${escapeXml(t)}</w:t></w:r>`);
  };
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) pushRun(text.slice(last, m.index), inherited);
    if (m[2] !== undefined) pushRun(m[2], Object.assign({}, inherited, { bold: true }));
    else if (m[4] !== undefined) pushRun(m[4], Object.assign({}, inherited, { italic: true }));
    else if (m[6] !== undefined) pushRun(m[6], Object.assign({}, inherited, { code: true }));
    last = m.index + m[0].length;
  }
  if (last < text.length) pushRun(text.slice(last), inherited);
  if (!runs.length) pushRun("", inherited);
  return runs.join("");
}

function markdownToDocxBody(markdown) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const out = [];
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) continue;
    let m;
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      const level = m[1].length;
      const sizes = [40, 36, 32, 28, 26, 24];
      const sz = sizes[level - 1];
      const pPr = `<w:pPr><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="${Math.min(level - 1, 5)}"/></w:pPr>`;
      const run = `<w:r><w:rPr><w:b/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr><w:t xml:space="preserve">${escapeXml(m[2].trim())}</w:t></w:r>`;
      out.push(`<w:p>${pPr}${run}</w:p>`);
    } else if ((m = line.match(/^\s*([-*•])\s+(.*)$/))) {
      const pPr = '<w:pPr><w:ind w:left="426" w:hanging="426"/><w:spacing w:after="40"/></w:pPr>';
      out.push(`<w:p>${pPr}<w:r><w:t xml:space="preserve">• </w:t></w:r>${docxInlineRuns(m[2], {})}</w:p>`);
    } else if ((m = line.match(/^\s*(\d+)[.)、]\s+(.*)$/))) {
      const pPr = '<w:pPr><w:ind w:left="426" w:hanging="426"/><w:spacing w:after="40"/></w:pPr>';
      out.push(`<w:p>${pPr}<w:r><w:t xml:space="preserve">${escapeXml(m[1])}. </w:t></w:r>${docxInlineRuns(m[2], {})}</w:p>`);
    } else {
      const pPr = '<w:pPr><w:spacing w:after="80"/></w:pPr>';
      out.push(`<w:p>${pPr}${docxInlineRuns(line, {})}</w:p>`);
    }
  }
  return out.join("");
}

function buildDocxDocumentXml(title, markdown) {
  const parts = [];
  const cleanTitle = String(title || "").trim();
  if (cleanTitle) {
    parts.push(
      '<w:p><w:pPr><w:spacing w:after="160"/><w:jc w:val="center"/></w:pPr>'
      + '<w:r><w:rPr><w:b/><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr>'
      + `<w:t xml:space="preserve">${escapeXml(cleanTitle)}</w:t></w:r></w:p>`
    );
  }
  parts.push(markdownToDocxBody(markdown));
  const sectPr = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
    + '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>';
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    + `<w:body>${parts.join("")}${sectPr}</w:body></w:document>`;
}

function buildDocxBuffer(title, markdown) {
  const zip = new AdmZip();
  zip.addFile("[Content_Types].xml", Buffer.from(DOCX_CONTENT_TYPES, "utf8"));
  zip.addFile("_rels/.rels", Buffer.from(DOCX_ROOT_RELS, "utf8"));
  zip.addFile("word/_rels/document.xml.rels", Buffer.from(DOCX_DOC_RELS, "utf8"));
  zip.addFile("word/styles.xml", Buffer.from(DOCX_STYLES, "utf8"));
  zip.addFile("word/document.xml", Buffer.from(buildDocxDocumentXml(title, markdown), "utf8"));
  return zip.toBuffer();
}

function sanitizeDocxFilename(raw) {
  const base = String(raw || "").replace(/[\r\n]/g, " ").replace(/[\\/:*?"<>|#%&{}$+!:'@|]/g, "").trim().slice(0, 60);
  return (base || "AI报告") + ".docx";
}

function contentDispositionAttachment(filename) {
  const ascii = "AI_Report.docx";
  const utf8 = encodeURIComponent(filename)
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/!/g, "%21")
    .replace(/\*/g, "%2A");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

function loadAiConfig() {
  try {
    if (!fs.existsSync(AI_CONFIG_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(AI_CONFIG_FILE, "utf8"));
    const env = raw && raw.env ? raw.env : {};
    const baseUrl = String(raw.baseUrl || env.ANTHROPIC_BASE_URL || "").trim().replace(/\/+$/, "");
    const authToken = String(raw.authToken || env.ANTHROPIC_AUTH_TOKEN || "").trim();
    if (!baseUrl || !authToken) return null;
    const maxTokensRaw = Number(raw.maxTokens || AI_DEFAULT_MAX_TOKENS);
    return {
      baseUrl,
      authToken,
      model: String(raw.model || AI_DEFAULT_MODEL).trim() || AI_DEFAULT_MODEL,
      maxTokens: Number.isFinite(maxTokensRaw) && maxTokensRaw > 0 ? maxTokensRaw : AI_DEFAULT_MAX_TOKENS
    };
  } catch (error) {
    logLine(`loadAiConfig failed: ${error.message}`);
    return null;
  }
}

function compactAiRecord(record) {
  if (record.category === "software") {
    return {
      id: record.id,
      类别: "软件",
      软件名称: record.softwareName,
      版本号: record.version,
      适用机型: record.model,
      适用场景: record.scenario,
      启用日期: record.enableDate,
      说明: record.description,
      文件名: record.originalFileName || record.fileName,
      源码SVN: record.sourceSvn
    };
  }
  return {
    id: record.id,
    类别: "固件",
    适用机型: record.model,
    适用场景: record.scenario,
    CPU1: record.cpu1Version,
    CPU2: record.cpu2Version,
    FPGA: record.fpgaVersion,
    ARM: record.armVersion,
    运行模式: record.gridMode,
    启用日期: record.enableDate,
    适用单机版本: record.applicableSingleVersion,
    适用多机版本: record.applicableMultiVersion,
    适用自动化版本: record.applicableAutomationVersion,
    说明: record.description,
    文件名: record.originalFileName || record.fileName
  };
}

function buildAiSystemPrompt() {
  const context = JSON.stringify(readDb().map(compactAiRecord));
  const optionsContext = JSON.stringify({
    软件名称可选项: options.softwareNames,
    机型可选项: options.models,
    适用场景可选项: options.scenarios,
    运行模式可选项: options.gridModes
  });
  return [
    "你是「固件与软件包管理系统」内置的 AI 助手，专门帮助用户检索、查询、对比和总结系统中已登记的固件与软件记录。",
    "下方 <repository> 标签内是系统当前的全部记录（JSON 数组，已按启用日期倒序）。请严格依据这些记录作答，不要编造不存在的机型、版本或记录。",
    "<options> 标签内是系统中各下拉字段（软件名称、机型、适用场景、运行模式）的完整可选项列表，代表系统支持的「全部合法取值」。请以它为准。",
    "作答要求：",
    "- 全部使用中文。",
    "- 涉及具体记录时，请同时给出适用机型、版本号、启用日期等关键字段，方便用户核对与下载。",
    "- 用户问“最新/最近”时，以记录中的「启用日期」为准进行排序。",
    "- 优先使用要点列表，避免使用 Markdown 表格。",
    "- 涉及“覆盖率/缺口/哪些还没上传/哪些选项没用过”之类的问题时，请用 <repository> 中记录实际出现过的取值，去对照 <options> 中的完整可选项列表，求出尚未出现过的项并明确列出。",
    "- 如果问题超出这些记录的范围（例如某记录不存在），请明确告知，并建议用户前往对应管理页面查看或补传。",
    "",
    "文件下载（重要）：每条记录在 repository 中都有 id 字段。当用户希望获取/下载某条记录对应的文件时，请在回答中单独一行输出下载标记来引用该记录，格式为：",
    '  [[DOWNLOAD id="<记录id>" name="<显示名，通常用文件名或机型+版本>"]]',
    "- 系统会自动把该标记渲染成一个下载按钮，你不需要额外解释这个标记，也不要把它放进代码块或表格里。",
    "- 一条回答里可以放多个标记（例如用户要下载多个文件时）。",
    "- 标记必须单独占一行，且 id 必须严格复制自 repository，不要自己编造 id。",
    "",
    "生成报告/文档：当用户希望生成报告、日志、文档（例如“写一份报告”“整理成文档”“导出日志”）时，请按结构化、信息完整的格式作答：使用「# 标题」「## 小节」组织层次，使用要点列表列出版本号、启用日期、说明、源码 SVN 等关键字段。回答完成后，用户可点击回答下方的「导出 Word」按钮将其保存为 .docx 文档，因此请尽量写出可以直接作为正式文档使用的内容。",
    "",
    `<repository>\n${context}\n</repository>`,
    "",
    `<options>\n${optionsContext}\n</options>`
  ].join("\n");
}

function normalizeAiMessages(incoming) {
  if (!Array.isArray(incoming)) return [];
  const cleaned = [];
  for (const item of incoming) {
    const role = item && item.role === "assistant" ? "assistant" : "user";
    const content = String(item && item.content ? item.content : "").trim();
    if (!content) continue;
    const last = cleaned[cleaned.length - 1];
    if (last && last.role === role) {
      last.content = `${last.content}\n${content}`.slice(0, AI_MAX_MESSAGE_CHARS);
    } else {
      cleaned.push({ role, content: content.slice(0, AI_MAX_MESSAGE_CHARS) });
    }
    if (cleaned.length >= AI_MAX_MESSAGE_TURNS) break;
  }
  while (cleaned.length && cleaned[0].role !== "user") cleaned.shift();
  return cleaned;
}

function aiSliceError(text) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, 400);
}

app.get("/api/ai/status", (_req, res) => {
  const config = loadAiConfig();
  res.json({
    configured: Boolean(config),
    model: config ? config.model : AI_DEFAULT_MODEL,
    maxTokens: config ? config.maxTokens : AI_DEFAULT_MAX_TOKENS,
    recordCount: readDb().length
  });
});

app.post("/api/ai/chat", async (req, res) => {
  const config = loadAiConfig();
  if (!config) {
    return res.status(503).json({ message: "AI 未配置：请在 ai_workspace/ai_config.json 中填写 ANTHROPIC_BASE_URL 与 ANTHROPIC_AUTH_TOKEN。" });
  }

  const messages = normalizeAiMessages(req.body && req.body.messages);
  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return res.status(400).json({ message: "请输入要提问的内容。" });
  }

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  let finished = false;
  const controller = new AbortController();
  const writeEvent = (event, data) => {
    if (finished) return;
    try {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch {
      // 连接已断开，忽略写入异常
    }
  };
  const finish = () => {
    if (finished) return;
    finished = true;
    try { controller.abort(); } catch {
      // 忽略中断异常
    }
    res.end();
  };
  res.on("close", () => finish());

  try {
    const upstream = await fetch(`${config.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.authToken,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: config.maxTokens,
        stream: true,
        system: buildAiSystemPrompt(),
        messages
      }),
      signal: controller.signal
    });

    if (!upstream.ok || !upstream.body) {
      const errText = await upstream.text().catch(() => "");
      writeEvent("error", { message: `AI助手返回错误（HTTP ${upstream.status}）：${aiSliceError(errText) || upstream.statusText}` });
      return finish();
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
        const rawLine = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        const line = rawLine.replace(/\r$/, "").trim();
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        let parsed;
        try {
          parsed = JSON.parse(payload);
        } catch {
          continue;
        }
        if (parsed.type === "content_block_delta" && parsed.delta && typeof parsed.delta.text === "string") {
          writeEvent("delta", { text: parsed.delta.text });
        } else if (parsed.type === "error" && parsed.error) {
          writeEvent("error", { message: parsed.error.message || "AI助手返回错误。" });
        }
      }
    }

    writeEvent("done", {});
  } catch (error) {
    const name = error && error.name ? error.name : "";
    if (name !== "AbortError" && !finished) {
      writeEvent("error", { message: `AI 请求失败：${error && error.message ? error.message : error}` });
    }
  } finally {
    finish();
  }
});

app.post("/api/ai/export/docx", (req, res) => {
  const title = String((req.body && req.body.title) || "").trim().slice(0, 200);
  const content = String((req.body && req.body.content) || "").trim();
  if (!content) {
    return res.status(400).json({ message: "没有可导出的内容" });
  }
  if (content.length > 60000) {
    return res.status(400).json({ message: "内容过长，无法导出（上限 6 万字符）" });
  }
  try {
    const buffer = buildDocxBuffer(title, content);
    const filename = sanitizeDocxFilename(title || content);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", contentDispositionAttachment(filename));
    return res.send(buffer);
  } catch (error) {
    logLine(`docx export failed: ${error && error.message ? error.message : error}`);
    return res.status(500).json({ message: "生成 Word 文档失败" });
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

process.on("uncaughtException", (error) => {
  logLine(`uncaughtException: ${error && error.stack ? error.stack : error}`);
});

process.on("unhandledRejection", (reason) => {
  logLine(`unhandledRejection: ${reason && reason.stack ? reason.stack : reason}`);
});

function getLanAccessUrls() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((item) => item && item.family === "IPv4" && !item.internal)
    .map((item) => `http://${item.address}:${PORT}`);
}

app.listen(PORT, HOST, () => {
  const lanUrls = getLanAccessUrls();
  logLine(`server started on ${HOST}:${PORT} lan=${lanUrls.join(" ") || "none"}`);
  console.log(`Firmware manager running at http://localhost:${PORT}`);
  if (lanUrls.length) {
    console.log("LAN access URLs:");
    lanUrls.forEach((url) => console.log(`  ${url}`));
  } else {
    console.log("LAN access URL: no non-internal IPv4 address found");
  }
});
