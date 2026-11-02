import { createHash, timingSafeEqual, createHmac } from 'node:crypto';

const MAX_SIZE = 2 * 1024 ** 3;
const CHUNK_SIZE = 8 * 1024 ** 2;
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }
});
const failure = (message, status = 400) => json({ error: message }, status);
const username = env => env.ADMIN_USERNAME || 'HS';
const digest = value => createHash('sha256').update(String(value)).digest();
const equal = (a, b) => timingSafeEqual(digest(a), digest(b));
export const safeFileName = value => typeof value === 'string' && value.length > 0 && value.length <= 200
  && !value.includes('..') && /^[\p{L}\p{N} ._\[\]-]+$/u.test(value);
const folder = kind => kind === 'firmware' ? 'firmware/releases' : 'software';
const downloadPath = (kind, name) => `/download/${kind === 'firmware' ? 'firmware-release' : 'software'}/${encodeURIComponent(name)}`;
const cookieValue = request => (request.headers.get('cookie') || '').split(';').map(s => s.trim()).find(s => s.startsWith('hs_admin='))?.slice(9);
const cookieHeader = (request, token, age) => `hs_admin=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;

async function authenticated(request, env) {
  const token = cookieValue(request);
  if (!token || !env.SESSION_SECRET) return false;
  const [id, signature, extra] = token.split('.');
  if (!id || !signature || extra) return false;
  const expected = createHmac('sha256', env.SESSION_SECRET).update(id).digest('hex');
  if (!equal(signature, expected)) return false;
  const session = await env.DB.prepare('SELECT expires_at FROM pcs_sessions WHERE id = ?').bind(id).first();
  return Boolean(session && session.expires_at > Date.now());
}

async function bodyJson(request) {
  const text = await request.text();
  if (text.length > 32768) throw new Error('请求内容过大');
  return text ? JSON.parse(text) : {};
}

async function login(request, env) {
  if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET) return failure('管理登录尚未配置', 503);
  const address = request.headers.get('cf-connecting-ip') || 'local';
  const key = digest(address).toString('hex');
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(`INSERT INTO login_attempts (ip_hash, attempts, window_started_at) VALUES (?, 1, ?)
    ON CONFLICT(ip_hash) DO UPDATE SET attempts = CASE WHEN window_started_at < ? THEN 1 ELSE attempts + 1 END,
    window_started_at = CASE WHEN window_started_at < ? THEN excluded.window_started_at ELSE window_started_at END`)
    .bind(key, now, now - 900, now - 900).run();
  const row = await env.DB.prepare('SELECT attempts FROM login_attempts WHERE ip_hash = ?').bind(key).first();
  if (row.attempts > 10) return failure('尝试次数过多，请 15 分钟后重试', 429);
  const body = await bodyJson(request);
  if (!equal(body.username || '', username(env)) || !equal(body.password || '', env.ADMIN_PASSWORD)) return failure('账号或密码不正确', 401);
  const id = crypto.randomUUID();
  const signature = createHmac('sha256', env.SESSION_SECRET).update(id).digest('hex');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM login_attempts WHERE ip_hash = ?').bind(key),
    env.DB.prepare('DELETE FROM pcs_sessions WHERE expires_at <= ?').bind(Date.now()),
    env.DB.prepare('INSERT INTO pcs_sessions (id, expires_at) VALUES (?, ?)').bind(id, Date.now() + 28800000)
  ]);
  return json({ username: username(env) }, 200, { 'set-cookie': cookieHeader(request, `${id}.${signature}`, 28800) });
}

async function manifest(env) {
  const { results } = await env.DB.prepare('SELECT kind, payload FROM pcs_packages ORDER BY published_at DESC, rowid DESC').all();
  const rows = results || [];
  return {
    server: { name: 'HS PCS Upgrade Server', version: '1.0.0', protocolVersion: 1 },
    software: rows.filter(row => row.kind === 'software').map(row => JSON.parse(row.payload)),
    firmware: rows.filter(row => row.kind === 'firmware').map(row => JSON.parse(row.payload))
  };
}

async function published(env, kind) {
  const items = (await manifest(env))[kind];
  const checked = await Promise.all(items.map(async item => {
    if (!safeFileName(item.fileName) || !item.fileName.toLowerCase().endsWith('.zip') || !/^[a-f0-9]{32}$/i.test(item.md5 || '') || item.fileSize <= 0) return null;
    if (kind === 'software' && item.product !== 'UARTGrapher' || kind === 'firmware' && item.device !== 'PCS') return null;
    const row = await env.DB.prepare('SELECT object_key FROM pcs_packages WHERE kind = ? AND file_name = ?').bind(kind, item.fileName).first();
    const object = row && await env.FILES.head(row.object_key);
    return object && object.size === item.fileSize ? item : null;
  }));
  return checked.filter(Boolean);
}

async function serveDownload(request, env, kind, fileName) {
  if (!safeFileName(fileName)) return failure('文件名不合法');
  const row = await env.DB.prepare('SELECT object_key FROM pcs_packages WHERE kind = ? AND file_name = ?').bind(kind, fileName).first();
  if (!row) return failure('file not found', 404);
  let object;
  const range = request.headers.get('range');
  if (range) object = await env.FILES.get(row.object_key, { range: request.headers });
  else object = await env.FILES.get(row.object_key);
  if (!object) return failure('file not found', 404);
  const headers = new Headers({
    'content-type': fileName.toLowerCase().endsWith('.zip') ? 'application/zip' : 'application/octet-stream',
    'content-disposition': `attachment; filename="download.zip"; filename*=UTF-8''${encodeURIComponent(fileName).replace(/'/g, '%27')}`,
    'cache-control': 'no-store', 'accept-ranges': 'bytes', 'etag': object.httpEtag
  });
  let status = 200;
  if (range && object.range && object.range.length !== undefined) {
    const { offset = 0, length } = object.range;
    headers.set('content-range', `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set('content-length', String(length)); status = 206;
  } else headers.set('content-length', String(object.size));
  return new Response(request.method === 'HEAD' ? null : object.body, { status, headers });
}

export function packageEntry(body, kind, fileName, fileSize, md5) {
  const version = String(body.version || '').trim();
  if (!version || version.length > 80) throw new Error('请填写不超过 80 个字符的版本号');
  return { product: kind === 'software' ? 'UARTGrapher' : null, device: kind === 'firmware' ? 'PCS' : null,
    displayName: String(body.displayName || (kind === 'firmware' ? 'PCS 固件整套' : '波形录波上位机 UARTGrapher')).slice(0, 200),
    version, fileName, fileSize, md5, publishedAt: new Date().toISOString(), changelog: String(body.changelog || '').slice(0, 10000),
    url: downloadPath(kind, fileName), components: kind === 'firmware' ? { CPU01: String(body.cpu01 || '').slice(0, 80), CPU02: String(body.cpu02 || '').slice(0, 80), FPGA: String(body.fpga || '').slice(0, 80) } : null };
}

async function startUpload(request, env, kind) {
  const body = await bodyJson(request);
  const { fileName, fileSize } = body;
  if (!safeFileName(fileName) || !fileName.toLowerCase().endsWith('.zip')) return failure('文件名不合法；软件包和整套固件仅支持 ZIP');
  if (!Number.isSafeInteger(fileSize) || fileSize < 1 || fileSize > MAX_SIZE) return failure('文件大小应为 1 字节至 2 GB');
  let entry;
  try { entry = packageEntry(body, kind, fileName, fileSize, ''); } catch (error) { return failure(error.message); }
  const existing = await env.DB.prepare('SELECT 1 FROM pcs_packages WHERE kind = ? AND file_name = ?').bind(kind, fileName).first();
  if (existing) return failure('服务器已存在同名文件，请更换文件名或先删除旧版本', 409);
  const id = crypto.randomUUID();
  const key = `pcs/${folder(kind)}/${id}/${fileName}`;
  const upload = await env.FILES.createMultipartUpload(key, { httpMetadata: { contentType: 'application/zip' } });
  try {
    await env.DB.prepare('INSERT INTO pcs_uploads (id,kind,file_name,object_key,multipart_id,payload,created_at) VALUES (?,?,?,?,?,?,?)')
      .bind(id, kind, fileName, key, upload.uploadId, JSON.stringify(entry), Date.now()).run();
  } catch { await upload.abort(); return failure('同名文件正在上传，请稍后重试或取消原上传', 409); }
  return json({ uploadId: id, chunkSize: CHUNK_SIZE });
}

async function uploadAction(request, env, id, action, number) {
  const row = await env.DB.prepare('SELECT * FROM pcs_uploads WHERE id = ?').bind(id).first();
  if (!row) return failure('上传会话不存在', 404);
  const upload = env.FILES.resumeMultipartUpload(row.object_key, row.multipart_id);
  const entry = JSON.parse(row.payload);
  if (action === 'parts') {
    const partNumber = Number(number);
    const total = Math.ceil(entry.fileSize / CHUNK_SIZE);
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > total) return failure('分片编号无效');
    const bytes = await request.arrayBuffer();
    const expectedSize = Math.min(CHUNK_SIZE, entry.fileSize - (partNumber - 1) * CHUNK_SIZE);
    if (bytes.byteLength !== expectedSize) return failure('分片大小不匹配');
    const part = await upload.uploadPart(partNumber, bytes);
    const parts = JSON.parse(row.parts).filter(p => p.partNumber !== partNumber);
    parts.push({ partNumber, etag: part.etag });
    await env.DB.prepare('UPDATE pcs_uploads SET parts = ? WHERE id = ?').bind(JSON.stringify(parts), id).run();
    return json(part);
  }
  if (action === 'abort') {
    await upload.abort().catch(() => {});
    await env.FILES.delete(row.object_key);
    await env.DB.prepare('DELETE FROM pcs_uploads WHERE id = ?').bind(id).run();
    return json({ ok: true });
  }
  const parts = JSON.parse(row.parts).sort((a, b) => a.partNumber - b.partNumber);
  if (parts.length !== Math.ceil(entry.fileSize / CHUNK_SIZE) || parts.some((p, i) => p.partNumber !== i + 1)) return failure('上传分片不完整');
  let object = await env.FILES.get(row.object_key);
  if (!object) { await upload.complete(parts); object = await env.FILES.get(row.object_key); }
  if (!object || object.size !== entry.fileSize) return failure('文件大小校验失败');
  const hash = createHash('md5');
  for await (const chunk of object.body) hash.update(chunk);
  entry.md5 = hash.digest('hex');
  entry.publishedAt = new Date().toISOString();
  try {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO pcs_packages (kind,file_name,object_key,payload,published_at) VALUES (?,?,?,?,?)')
        .bind(row.kind, entry.fileName, row.object_key, JSON.stringify(entry), entry.publishedAt),
      env.DB.prepare('DELETE FROM pcs_uploads WHERE id = ?').bind(id)
    ]);
  } catch { return failure('发布记录保存失败，请重试完成上传', 409); }
  return json({ ok: true, fileName: entry.fileName, md5: entry.md5, size: entry.fileSize });
}

async function route(request, env) {
  const url = new URL(request.url);
  const path = decodeURIComponent(url.pathname);
  const method = request.method;
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const origin = request.headers.get('origin');
    if (origin && origin !== url.origin || request.headers.get('sec-fetch-site') === 'cross-site') return failure('请求来源无效', 403);
  }
  if (path === '/api/admin/login' && method === 'POST') return login(request, env);
  if (path === '/api/admin/session' && method === 'GET') return await authenticated(request, env) ? json({ username: username(env) }) : failure('请先登录', 401);
  const registry = path === '/registry' || path.startsWith('/registry/') || path === '/api/admin/registry';
  if (path.startsWith('/api/admin/') || registry) {
    if (!await authenticated(request, env)) return registry && !path.startsWith('/api/') ? Response.redirect(`${url.origin}/`, 302) : failure('请先登录', 401);
    if (registry) {
      const asset = await env.FILES.get('pcs/private/registry.html');
      if (!asset) return failure('注册码工具尚未迁移', 503);
      return new Response(asset.body, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store', 'x-frame-options': 'SAMEORIGIN' } });
    }
    if (path === '/api/admin/logout' && method === 'POST') {
      await env.DB.prepare('DELETE FROM pcs_sessions WHERE id = ?').bind(cookieValue(request).split('.')[0]).run();
      return json({ ok: true }, 200, { 'set-cookie': cookieHeader(request, '', 0) });
    }
    if (path === '/api/admin/manifest' && method === 'GET') return json(await manifest(env));
    const create = path.match(/^\/api\/admin\/(software|firmware)$/);
    if (create && method === 'POST') return startUpload(request, env, create[1]);
    const part = path.match(/^\/api\/admin\/uploads\/([^/]+)\/(parts\/(\d+)|complete|abort)$/);
    if (part && ((part[3] && method === 'PUT') || (!part[3] && method === 'POST'))) return uploadAction(request, env, part[1], part[3] ? 'parts' : part[2], part[3]);
    const remove = path.match(/^\/api\/admin\/(software|firmware)\/([^/]+)$/);
    if (remove && method === 'DELETE') {
      const row = await env.DB.prepare('SELECT object_key FROM pcs_packages WHERE kind = ? AND file_name = ?').bind(remove[1], remove[2]).first();
      await env.DB.prepare('DELETE FROM pcs_packages WHERE kind = ? AND file_name = ?').bind(remove[1], remove[2]).run();
      if (row) await env.FILES.delete(row.object_key);
      return json({ ok: true });
    }
    return failure('未找到接口', 404);
  }
  if ((path === '/api' || path === '/api/') && method === 'GET') return json({ name: 'HS PCS Upgrade Server', status: 'ok', protocolVersion: 1 });
  if (path === '/api/manifest' && method === 'GET') return json(await manifest(env));
  const list = path.match(/^\/api\/(software|firmware)\/(versions|releases|latest)$/);
  if (list && method === 'GET' && (list[2] === 'latest' || list[1] === 'software' && list[2] === 'versions' || list[1] === 'firmware' && list[2] === 'releases')) {
    const rows = await published(env, list[1]);
    return list[2] === 'latest' ? rows.length ? json(rows[0]) : failure('no published package', 404) : json(rows);
  }
  const download = path.match(/^\/download\/(software|firmware-release)\/([^/]+)$/);
  if (download && ['GET', 'HEAD'].includes(method)) return serveDownload(request, env, download[1] === 'software' ? 'software' : 'firmware', download[2]);
  if (['GET','HEAD'].includes(method) && (path === '/' || path === '/index.html' || /^\/assets\/admin\.(css|js)$/.test(path))) {
    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers); headers.set('cache-control', 'no-store');
    return new Response(response.body, { status: response.status, headers });
  }
  return failure('未找到页面或接口', 404);
}

export default { async fetch(request, env) {
  try {
    const response = await route(request, env);
    const headers = new Headers(response.headers);
    headers.set('x-content-type-options', 'nosniff'); headers.set('referrer-policy', 'same-origin');
    headers.set('x-frame-options', 'SAMEORIGIN');
    return new Response(response.body, { status: response.status, headers });
  } catch (error) {
    console.error('PCS request failed', error);
    return failure(error instanceof SyntaxError ? '请求内容格式无效' : error.message || '服务器错误', error instanceof SyntaxError ? 400 : 500);
  }
} };
