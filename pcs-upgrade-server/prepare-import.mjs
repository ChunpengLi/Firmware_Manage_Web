import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
const root = process.argv[2];
if (!root) throw new Error('Pass the local PcsUpgradeServer project directory');
const manifest = JSON.parse(readFileSync(join(root, 'Data/manifest.json'), 'utf8'));
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
const sql = [];
for (const kind of ['software', 'firmware']) for (const entry of manifest[kind] || []) {
  const folder = kind === 'software' ? 'software' : 'firmware/releases';
  const file = readFileSync(join(root, 'Data', folder, entry.fileName));
  if (file.length !== entry.fileSize || createHash('md5').update(file).digest('hex') !== entry.md5) throw new Error('File checksum mismatch: ' + entry.fileName);
  const key = `pcs/${folder}/${entry.fileName}`;
  sql.push(`INSERT INTO pcs_packages (kind,file_name,object_key,payload,published_at) VALUES (${[kind, entry.fileName, key, JSON.stringify(entry), entry.publishedAt].map(quote).join(',')}) ON CONFLICT(kind,file_name) DO NOTHING;`);
  console.log(JSON.stringify({ kind, key, fileName: entry.fileName, size: entry.fileSize, md5: entry.md5 }));
}
writeFileSync(new URL('./import.sql', import.meta.url), sql.join('\n'));
