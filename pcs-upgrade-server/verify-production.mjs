import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const origin = 'https://cpeng.uk';
const call = async (path, options = {}) => {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await fetch(origin + path, { redirect: 'manual', signal: AbortSignal.timeout(25000), ...options }); } catch (error) { last = error; }
  }
  throw last;
};
const page = await call('/');
assert.equal(page.status, 200);
assert.match(await page.text(), /HS PCS · SERVER CONSOLE/);
assert.equal((await call('/api/admin/manifest')).status, 401);
assert.equal((await call('/api/admin/registry')).status, 401);
assert.equal((await call('/registry/index.html')).status, 302);
assert.equal((await call('/styles.css')).status, 404);
assert.equal((await call('/api/firmwares')).status, 404);
for (const [kind, route] of [['software', '/api/software/versions'], ['firmware', '/api/firmware/releases']]) {
  const response = await call(route);
  assert.equal(response.status, 200);
  const releases = await response.json();
  assert.ok(releases.length > 0);
  for (const item of releases) {
    const download = await call(item.url);
    assert.equal(download.status, 200);
    const bytes = Buffer.from(await download.arrayBuffer());
    assert.equal(bytes.length, item.fileSize);
    assert.equal(createHash('md5').update(bytes).digest('hex'), item.md5);
    const range = await call(item.url, { headers: { range: 'bytes=0-99' } });
    assert.equal(range.status, 206);
    assert.equal((await range.arrayBuffer()).byteLength, 100);
    console.log(JSON.stringify({ kind, version: item.version, fileSize: item.fileSize, md5Verified: true, rangeVerified: true }));
  }
}
console.log('PASS: production PCS page, protected management and registry, retired legacy endpoints, public versions and verified downloads');
