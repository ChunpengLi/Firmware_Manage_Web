import { zipSync } from "fflate";
import {
  ARCHIVE_EXTENSIONS,
  CATEGORY_LABELS,
  DEFAULT_OPTIONS,
  applyOptionChanges,
  buildAiSystemPrompt,
  buildObjectKey,
  buildRecordFromBody,
  escapeXml,
  filterRecords,
  normalizeAiMessages,
  normalizeRecord,
  sortRecords,
  ValidationError
} from "./domain.js";

const encoder = new TextEncoder();
class RequestTooLargeError extends Error {}
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
  + '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="宋体" w:cs="Calibri"/>'
  + '<w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault>'
  + '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>'
  + '</w:docDefaults></w:styles>';

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers }
});

function errorResponse(message, status = 400) {
  return json({ message }, status);
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new Error("请求内容不是有效 JSON");
  }
}

async function getRecords(env) {
  const result = await env.DB.prepare("SELECT payload FROM firmware_records ORDER BY created_at DESC").all();
  return (result.results || []).map((row) => normalizeRecord(JSON.parse(row.payload)));
}

async function getRecord(env, id) {
  const row = await env.DB.prepare("SELECT payload FROM firmware_records WHERE id = ?1").bind(id).first();
  return row ? normalizeRecord(JSON.parse(row.payload)) : null;
}

async function saveRecord(env, record) {
  const payload = JSON.stringify(record);
  await env.DB.prepare(`INSERT INTO firmware_records (id, category, payload, created_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5)
    ON CONFLICT(id) DO UPDATE SET category = excluded.category, payload = excluded.payload, updated_at = excluded.updated_at`)
    .bind(record.id, record.category, payload, record.createdAt, record.updatedAt).run();
}

async function getOptions(env) {
  const row = await env.DB.prepare("SELECT value FROM app_settings WHERE key = 'options'").first();
  if (!row) return structuredClone(DEFAULT_OPTIONS);
  try {
    return { ...DEFAULT_OPTIONS, ...JSON.parse(row.value) };
  } catch {
    return structuredClone(DEFAULT_OPTIONS);
  }
}

async function setOptions(env, oldOptions, newOptions) {
  const records = await getRecords(env);
  const affectedRecords = applyOptionChanges(records, oldOptions, newOptions);
  const statements = records.map((record) => env.DB.prepare(`INSERT INTO firmware_records (id, category, payload, created_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5)
    ON CONFLICT(id) DO UPDATE SET category = excluded.category, payload = excluded.payload, updated_at = excluded.updated_at`)
    .bind(record.id, record.category, JSON.stringify(record), record.createdAt, record.updatedAt));
  statements.push(env.DB.prepare("INSERT INTO app_settings (key, value) VALUES ('options', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(JSON.stringify(newOptions)));
  await env.DB.batch(statements);
  return affectedRecords;
}

function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value) {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function signSession(payload, secret) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
}

async function sessionCookie(request, secret) {
  const cookie = request.headers.get("cookie") || "";
  const token = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("firmware_admin="))?.slice("firmware_admin=".length);
  if (!token || !secret) return false;
  const [payloadPart, signaturePart] = token.split(".");
  if (!payloadPart || !signaturePart) return false;
  try {
    const payload = new TextDecoder().decode(fromBase64Url(payloadPart));
    const [expiresAt] = payload.split(".");
    if (!/^\d+$/.test(expiresAt) || Number(expiresAt) <= Math.floor(Date.now() / 1000)) return false;
    const expected = await signSession(payload, secret);
    const actual = fromBase64Url(signaturePart);
    if (actual.length !== expected.length) return false;
    return expected.every((value, index) => value === actual[index]);
  } catch {
    return false;
  }
}

function safeEqual(left, right) {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let mismatch = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) mismatch |= (a[index % (a.length || 1)] || 0) ^ (b[index % (b.length || 1)] || 0);
  return mismatch === 0;
}

async function rateLimitLogin(request, env) {
  const address = request.headers.get("cf-connecting-ip") || "unknown";
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(address)));
  const ipHash = [...digest.slice(0, 16)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare("SELECT attempts, window_started_at FROM login_attempts WHERE ip_hash = ?1").bind(ipHash).first();
  if (row && now - row.window_started_at < 900 && row.attempts >= 10) return null;
  const attempts = row && now - row.window_started_at < 900 ? row.attempts + 1 : 1;
  const started = row && now - row.window_started_at < 900 ? row.window_started_at : now;
  await env.DB.prepare(`INSERT INTO login_attempts (ip_hash, attempts, window_started_at) VALUES (?1, ?2, ?3)
    ON CONFLICT(ip_hash) DO UPDATE SET attempts = excluded.attempts, window_started_at = excluded.window_started_at`)
    .bind(ipHash, attempts, started).run();
  return ipHash;
}

async function requireAdmin(request, env) {
  if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET) return errorResponse("管理登录尚未配置", 503);
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return errorResponse("请求来源无效", 403);
  if (await sessionCookie(request, env.SESSION_SECRET)) return null;
  return errorResponse("此操作需要管理员登录", 401);
}

async function jsonBody(request) {
  const text = await request.text();
  if (text.length > 256_000) throw new RequestTooLargeError("请求内容过大");
  return text ? JSON.parse(text) : {};
}

async function createLogin(request, env, url) {
  if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET) return errorResponse("管理登录尚未配置", 503);
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) return errorResponse("请求来源无效", 403);
  const ipHash = await rateLimitLogin(request, env);
  if (!ipHash) return errorResponse("尝试次数过多，请 15 分钟后重试", 429);
  const body = await jsonBody(request);
  if (!safeEqual(String(body.password || ""), env.ADMIN_PASSWORD)) return errorResponse("密码错误", 401);
  await env.DB.prepare("DELETE FROM login_attempts WHERE ip_hash = ?1").bind(ipHash).run();
  const payload = `${Math.floor(Date.now() / 1000) + 28800}.${crypto.randomUUID()}`;
  const signature = await signSession(payload, env.SESSION_SECRET);
  const token = `${toBase64Url(encoder.encode(payload))}.${toBase64Url(signature)}`;
  const secure = url.protocol === "https:" ? "; Secure" : "";
  return json({ ok: true }, 200, { "set-cookie": `firmware_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secure}` });
}

function docxInlineRuns(text, inherited = {}) {
  const runs = [];
  const pattern = /(\*\*([^*]+)\*\*)|(\*([^*\n]+)\*)|(`([^`]+)`)/g;
  let last = 0;
  const push = (value, options = {}) => {
    if (!value) return;
    const properties = [];
    if (options.bold) properties.push("<w:b/>");
    if (options.italic) properties.push("<w:i/>");
    if (options.code) properties.push('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>');
    const props = properties.length ? `<w:rPr>${properties.join("")}</w:rPr>` : "";
    runs.push(`<w:r>${props}<w:t xml:space="preserve">${escapeXml(value)}</w:t></w:r>`);
  };
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) push(text.slice(last, match.index), inherited);
    if (match[2] !== undefined) push(match[2], { ...inherited, bold: true });
    else if (match[4] !== undefined) push(match[4], { ...inherited, italic: true });
    else if (match[6] !== undefined) push(match[6], { ...inherited, code: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) push(text.slice(last), inherited);
  return runs.join("") || "<w:r><w:t></w:t></w:r>";
}

function buildDocxXml(title, markdown) {
  const paragraphs = [];
  const cleanTitle = String(title || "").trim();
  if (cleanTitle) paragraphs.push(`<w:p><w:pPr><w:spacing w:after="160"/><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr><w:t xml:space="preserve">${escapeXml(cleanTitle)}</w:t></w:r></w:p>`);
  for (const raw of String(markdown || "").replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    const bullet = line.match(/^\s*([-*•])\s+(.*)$/);
    const numbered = line.match(/^\s*(\d+)[.)、]\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const size = [40, 36, 32, 28, 26, 24][level - 1];
      paragraphs.push(`<w:p><w:pPr><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="${level - 1}"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr><w:t xml:space="preserve">${escapeXml(heading[2])}</w:t></w:r></w:p>`);
    } else if (bullet || numbered) {
      const prefix = bullet ? "• " : `${numbered[1]}. `;
      const content = bullet ? bullet[2] : numbered[2];
      paragraphs.push(`<w:p><w:pPr><w:ind w:left="426" w:hanging="426"/><w:spacing w:after="40"/></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(prefix)}</w:t></w:r>${docxInlineRuns(content)}</w:p>`);
    } else {
      paragraphs.push(`<w:p><w:pPr><w:spacing w:after="80"/></w:pPr>${docxInlineRuns(line)}</w:p>`);
    }
  }
  const section = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>';
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    + `<w:body>${paragraphs.join("")}${section}</w:body></w:document>`;
}

function docxResponse(title, content) {
  const files = {
    "[Content_Types].xml": encoder.encode(DOCX_CONTENT_TYPES),
    "_rels/.rels": encoder.encode(DOCX_ROOT_RELS),
    "word/_rels/document.xml.rels": encoder.encode(DOCX_DOC_RELS),
    "word/styles.xml": encoder.encode(DOCX_STYLES),
    "word/document.xml": encoder.encode(buildDocxXml(title, content))
  };
  const buffer = zipSync(files);
  const filename = `${String(title || "AI报告").replace(/[\r\n\\/:*?"<>|#%&{}$+!:'@|]/g, "").trim().slice(0, 60) || "AI报告"}.docx`;
  const encoded = encodeURIComponent(filename).replace(/'/g, "%27").replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/!/g, "%21").replace(/\*/g, "%2A");
  return new Response(buffer, { headers: {
    "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "content-disposition": `attachment; filename="AI_Report.docx"; filename*=UTF-8''${encoded}`
  } });
}

async function startUpload(request, env) {
  const body = await jsonBody(request);
  const filename = String(body.filename || "");
  const size = Number(body.size);
  const mimeType = String(body.mimeType || "application/octet-stream").slice(0, 120);
  if (!filename || !Number.isSafeInteger(size) || size < 1 || size > 1024 * 1024 * 1024) return errorResponse("文件无效或超过 1 GB 上限");
  const extension = filename.match(/\.[^.\\/]+$/)?.[0]?.toLowerCase() || "";
  if (!ARCHIVE_EXTENSIONS.has(extension)) return errorResponse("请上传 .zip、.rar 或 .7z 压缩包");

  const options = await getOptions(env);
  const existing = body.recordId ? await getRecord(env, String(body.recordId)) : null;
  if (body.recordId && !existing) return errorResponse("未找到要编辑的记录", 404);
  const id = existing?.id || crypto.randomUUID();
  const now = new Date().toISOString();
  const record = {
    ...buildRecordFromBody(body.record || {}, existing || {}, options),
    id,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
  const objectKey = buildObjectKey(record, filename);
  const upload = await env.FILES.createMultipartUpload(objectKey, { httpMetadata: { contentType: mimeType } });
  const sessionId = crypto.randomUUID();
  const payload = {
    record: { ...record, objectKey, relativePath: objectKey, fileName: filename.split(/[\\/]/).pop(), originalFileName: filename.split(/[\\/]/).pop(), fileSize: size, mimeType },
    size
  };
  await env.DB.prepare(`INSERT INTO upload_sessions (id, record_id, object_key, multipart_id, payload, old_object_key, created_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`)
    .bind(sessionId, id, objectKey, upload.uploadId, JSON.stringify(payload), existing?.objectKey || existing?.relativePath || null, now).run();
  return json({ uploadId: sessionId, recordId: id, chunkSize: 8 * 1024 * 1024 });
}

async function uploadPart(request, env, sessionId, partNumber) {
  const number = Number(partNumber);
  if (!Number.isInteger(number) || number < 1 || number > 10000) return errorResponse("分片编号无效");
  const session = await env.DB.prepare("SELECT * FROM upload_sessions WHERE id = ?1").bind(sessionId).first();
  if (!session) return errorResponse("上传会话不存在或已过期", 404);
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > 10 * 1024 * 1024) return errorResponse("分片大小无效");
  const upload = env.FILES.resumeMultipartUpload(session.object_key, session.multipart_id);
  const result = await upload.uploadPart(number, bytes);
  return json({ partNumber: number, etag: result.etag });
}

async function completeUpload(request, env, sessionId) {
  const session = await env.DB.prepare("SELECT * FROM upload_sessions WHERE id = ?1").bind(sessionId).first();
  if (!session) return errorResponse("上传会话不存在或已过期", 404);
  const body = await jsonBody(request);
  const parts = Array.isArray(body.parts) ? body.parts.map((part) => ({ partNumber: Number(part.partNumber), etag: String(part.etag || "") })) : [];
  if (!parts.length || parts.some((part) => !Number.isInteger(part.partNumber) || part.partNumber < 1 || !part.etag)) return errorResponse("上传分片信息不完整");
  parts.sort((a, b) => a.partNumber - b.partNumber);
  if (parts.some((part, index) => index > 0 && parts[index - 1].partNumber === part.partNumber)) return errorResponse("上传分片编号重复");

  const upload = env.FILES.resumeMultipartUpload(session.object_key, session.multipart_id);
  await upload.complete(parts);
  const payload = JSON.parse(session.payload);
  try {
    await saveRecord(env, payload.record);
  } catch (error) {
    await env.FILES.delete(session.object_key);
    throw error;
  }
  if (session.old_object_key && session.old_object_key !== session.object_key) await env.FILES.delete(session.old_object_key);
  await env.DB.prepare("DELETE FROM upload_sessions WHERE id = ?1").bind(sessionId).run();
  return json(payload.record, 201);
}

async function abortUpload(env, sessionId) {
  const session = await env.DB.prepare("SELECT * FROM upload_sessions WHERE id = ?1").bind(sessionId).first();
  if (!session) return json({ ok: true });
  await env.FILES.resumeMultipartUpload(session.object_key, session.multipart_id).abort();
  await env.DB.prepare("DELETE FROM upload_sessions WHERE id = ?1").bind(sessionId).run();
  return json({ ok: true });
}

async function handleApi(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  if (path === "/api/auth/session" && method === "GET") return json({ authenticated: await sessionCookie(request, env.SESSION_SECRET) });
  if (path === "/api/auth/login" && method === "POST") return createLogin(request, env, url);
  if (path === "/api/auth/logout" && method === "POST") {
    const secure = url.protocol === "https:" ? "; Secure" : "";
    return json({ ok: true }, 200, { "set-cookie": `firmware_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}` });
  }

  if (path === "/api/meta" && method === "GET") {
    const [records, options] = await Promise.all([getRecords(env), getOptions(env)]);
    return json({
      categories: CATEGORY_LABELS,
      firmwareModels: options.models,
      gridModes: options.gridModes,
      scenarios: options.scenarios,
      softwareNames: options.softwareNames,
      archiveExtensions: [...ARCHIVE_EXTENSIONS],
      storageRoot: "固件与软件：Cloudflare R2",
      storageRoots: { firmware: "firmware/", software: "software/" },
      publicDownloads: env.PUBLIC_DOWNLOADS === "true",
      total: records.length
    });
  }

  if (path === "/api/firmwares" && method === "GET") return json(filterRecords(await getRecords(env), url.searchParams));
  if (path === "/api/options" && method === "GET") return json(await getOptions(env));
  if (path === "/api/upgrade/status" && method === "GET") return json({ running: false, ok: true, message: "网站由 GitHub 推送自动部署", updatedAt: "" });
  if ((path === "/api/upgrade" || path === "/api/restart") && method === "POST") return errorResponse("服务器版本由 GitHub 自动部署，请推送新版本到 main 分支", 410);

  if (path === "/api/firmwares" && method === "POST") {
    const denied = await requireAdmin(request, env);
    if (denied) return denied;
    return startUpload(request, env);
  }
  if (path === "/api/options" && method === "PUT") {
    const denied = await requireAdmin(request, env);
    if (denied) return denied;
    const body = await jsonBody(request);
    const oldOptions = await getOptions(env);
    const newOptions = {
      models: Array.isArray(body.models) ? body.models.filter(Boolean).map((value) => String(value).trim()) : oldOptions.models,
      scenarios: Array.isArray(body.scenarios) ? body.scenarios.filter(Boolean).map((value) => String(value).trim()) : oldOptions.scenarios,
      gridModes: Array.isArray(body.gridModes) ? body.gridModes.filter(Boolean).map((value) => String(value).trim()) : oldOptions.gridModes,
      softwareNames: Array.isArray(body.softwareNames) ? body.softwareNames.filter(Boolean).map((value) => String(value).trim()) : oldOptions.softwareNames
    };
    if (Object.values(newOptions).some((list) => !list.length || list.some((value) => value.length > 120))) return errorResponse("选项不能为空，且每项不能超过 120 个字符");
    const affectedRecords = await setOptions(env, oldOptions, newOptions);
    return json({ ok: true, options: newOptions, changes: { affectedRecords } });
  }

  const uploadPartMatch = path.match(/^\/api\/uploads\/([^/]+)\/parts\/(\d+)$/);
  if (uploadPartMatch && method === "PUT") {
    const denied = await requireAdmin(request, env);
    if (denied) return denied;
    return uploadPart(request, env, uploadPartMatch[1], uploadPartMatch[2]);
  }
  const uploadSessionMatch = path.match(/^\/api\/uploads\/([^/]+)\/(complete|abort)$/);
  if (uploadSessionMatch && method === "POST") {
    const denied = await requireAdmin(request, env);
    if (denied) return denied;
    return uploadSessionMatch[2] === "complete" ? completeUpload(request, env, uploadSessionMatch[1]) : abortUpload(env, uploadSessionMatch[1]);
  }

  const detailMatch = path.match(/^\/api\/firmwares\/([^/]+)(?:\/(download))?$/);
  if (detailMatch) {
    const id = decodeURIComponent(detailMatch[1]);
    if (method === "GET" && !detailMatch[2]) {
      const record = await getRecord(env, id);
      return record ? json(record) : errorResponse("未找到记录", 404);
    }
    if (method === "GET" && detailMatch[2]) {
      if (env.PUBLIC_DOWNLOADS !== "true") {
        const denied = await requireAdmin(request, env);
        if (denied) return denied;
      }
      const record = await getRecord(env, id);
      if (!record) return errorResponse("未找到记录", 404);
      const key = record.objectKey || record.relativePath;
      if (!key) return errorResponse("服务器文件不存在", 404);
      const object = await env.FILES.get(key);
      if (!object) return errorResponse("服务器文件不存在", 404);
      const filename = record.originalFileName || record.fileName || "download";
      const encoded = encodeURIComponent(filename).replace(/'/g, "%27").replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/!/g, "%21").replace(/\*/g, "%2A");
      return new Response(object.body, { headers: {
        "content-type": object.httpMetadata?.contentType || record.mimeType || "application/octet-stream",
        "content-length": String(object.size),
        "content-disposition": `attachment; filename="download"; filename*=UTF-8''${encoded}`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff"
      } });
    }
    if (method === "PUT") {
      const denied = await requireAdmin(request, env);
      if (denied) return denied;
      const existing = await getRecord(env, id);
      if (!existing) return errorResponse("未找到记录", 404);
      const updated = { ...buildRecordFromBody(await jsonBody(request), existing, await getOptions(env)), id, createdAt: existing.createdAt, updatedAt: new Date().toISOString() };
      updated.objectKey = existing.objectKey || existing.relativePath;
      updated.relativePath = updated.objectKey;
      Object.assign(updated, { fileName: existing.fileName, originalFileName: existing.originalFileName, fileSize: existing.fileSize, mimeType: existing.mimeType });
      await saveRecord(env, updated);
      return json(updated);
    }
    if (method === "DELETE") {
      const denied = await requireAdmin(request, env);
      if (denied) return denied;
      const record = await getRecord(env, id);
      if (!record) return errorResponse("未找到记录", 404);
      await env.DB.prepare("DELETE FROM firmware_records WHERE id = ?1").bind(id).run();
      const key = record.objectKey || record.relativePath;
      if (key) await env.FILES.delete(key);
      return json({ ok: true });
    }
  }

  if (path === "/api/ai/status" && method === "GET") {
    const result = await env.DB.prepare("SELECT COUNT(*) AS count FROM firmware_records").first();
    return json({ configured: Boolean(env.ANTHROPIC_AUTH_TOKEN && env.ANTHROPIC_BASE_URL), model: env.AI_MODEL || "claude-sonnet-4-5-20250929", maxTokens: Number(env.AI_MAX_TOKENS || 2048), recordCount: result?.count || 0 });
  }
  if (path === "/api/ai/chat" && method === "POST") {
    const denied = await requireAdmin(request, env);
    if (denied) return denied;
    return chatWithAi(request, env);
  }
  if (path === "/api/ai/export/docx" && method === "POST") {
    const denied = await requireAdmin(request, env);
    if (denied) return denied;
    const body = await jsonBody(request);
    const title = String(body.title || "").trim().slice(0, 200);
    const content = String(body.content || "").trim();
    if (!content) return errorResponse("没有可导出的内容");
    if (content.length > 60000) return errorResponse("内容过长，无法导出（上限 6 万字符）");
    return docxResponse(title, content);
  }

  return errorResponse("未找到 API 接口", 404);
}

async function chatWithAi(request, env) {
  if (!env.ANTHROPIC_AUTH_TOKEN || !env.ANTHROPIC_BASE_URL) return errorResponse("AI 未配置，请设置 Worker secrets", 503);
  const messages = normalizeAiMessages((await jsonBody(request)).messages);
  if (!messages.length || messages.at(-1).role !== "user") return errorResponse("请输入要提问的内容");
  const baseUrl = String(env.ANTHROPIC_BASE_URL).trim().replace(/\/+$/, "");
  let upstream;
  try {
    upstream = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_AUTH_TOKEN, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: env.AI_MODEL || "claude-sonnet-4-5-20250929",
        max_tokens: Number(env.AI_MAX_TOKENS || 2048),
        stream: true,
        system: buildAiSystemPrompt(await getRecords(env), await getOptions(env)),
        messages
      })
    });
  } catch (error) {
    return errorResponse(`AI 请求失败：${error.message}`, 502);
  }
  if (!upstream.ok || !upstream.body) return errorResponse(`AI 服务返回 HTTP ${upstream.status}`, 502);

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const stream = new ReadableStream({
    async start(controller) {
      let buffer = "";
      const send = (event, data) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let newline;
          while ((newline = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, newline).replace(/\r$/, "").trim();
            buffer = buffer.slice(newline + 1);
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            let parsed;
            try { parsed = JSON.parse(payload); } catch { continue; }
            if (parsed.type === "content_block_delta" && typeof parsed.delta?.text === "string") send("delta", { text: parsed.delta.text });
            if (parsed.type === "error" && parsed.error) send("error", { message: parsed.error.message || "AI 服务返回错误" });
          }
        }
        send("done", {});
      } catch (error) {
        send("error", { message: `AI 请求失败：${error.message}` });
      } finally {
        controller.close();
      }
    },
    cancel() { return reader.cancel(); }
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" } });
}

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
      return await handleApi(request, env, ctx);
    } catch (error) {
      console.error("request failed", error);
      const status = error instanceof RequestTooLargeError ? 413 : error instanceof ValidationError || error instanceof SyntaxError ? 400 : 500;
      return errorResponse(error.message || "服务器错误", status);
    }
  }
};
