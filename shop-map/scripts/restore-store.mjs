import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const [directory, flag] = process.argv.slice(2);
if (!directory || flag !== '--replace' || process.argv.length !== 4) {
  console.error('Usage: node scripts/restore-store.mjs backups/FOLDER --replace');
  console.error('Restores every map in the backup. Existing maps absent from the backup remain untouched.');
  process.exit(1);
}

const types = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };
const safeFile = name => typeof name === 'string' && /^(?:store\.json|map-\d+\.json|(?:store-map|map-\d+)\.(?:png|jpg|webp))$/.test(name);
async function restoreToken() {
  if (process.env.AISLE_RESTORE_TOKEN) return process.env.AISLE_RESTORE_TOKEN;
  const vars = await readFile('.dev.vars', 'utf8').catch(() => '');
  const raw = vars.match(/^AISLE_RESTORE_TOKEN\s*=\s*(.*)$/m)?.[1]?.trim();
  return raw?.replace(/^(["'])(.*)\1$/, '$2') || null;
}

try {
  const token = await restoreToken();
  if (!token) throw new Error('Set AISLE_RESTORE_TOKEN in .dev.vars or the environment before restoring.');
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  if (!manifest.files || typeof manifest.files !== 'object') throw new Error('Invalid backup manifest');
  const descriptions = Array.isArray(manifest.maps) ? manifest.maps :
    [{ mapId: 1, name: 'My store', stateFile: 'store.json', imageFile: Object.keys(manifest.files).find(name => /^store-map\.(png|jpg|webp)$/.test(name)) ?? null }];
  if (descriptions.length === 0 || descriptions.length > 100) throw new Error('Invalid backup map list');
  const seenIds = new Set();
  const verified = async name => {
    if (!safeFile(name)) throw new Error(`Invalid backup file name: ${name}`);
    const bytes = await readFile(join(directory, name));
    if (createHash('sha256').update(bytes).digest('hex') !== manifest.files[name]) throw new Error(`Checksum mismatch or missing checksum: ${name}`);
    return bytes;
  };
  const entries = [];
  for (const description of descriptions) {
    const { mapId, name, stateFile, imageFile } = description;
    if (!Number.isSafeInteger(mapId) || mapId < 1 || seenIds.has(mapId) || typeof name !== 'string' || !name.trim() || name.length > 100 ||
        stateFile !== (mapId === 1 ? 'store.json' : `map-${mapId}.json`) ||
        (imageFile !== null && !Object.keys(types).some(ext => imageFile === `${mapId === 1 ? 'store-map' : `map-${mapId}`}.${ext}`))) {
      throw new Error('Invalid backup map entry');
    }
    seenIds.add(mapId);
    const state = JSON.parse((await verified(stateFile)).toString('utf8'));
    if (Array.isArray(manifest.maps) && (state.mapId !== mapId || state.name !== name)) throw new Error('Backup map metadata does not match');
    if (Boolean(state.map) !== Boolean(imageFile)) throw new Error('Backup map image does not match state');
    const image = imageFile ? await verified(imageFile) : null;
    entries.push({ mapId, name, state, image, imageFile });
  }
  const expectedFiles = new Set(entries.flatMap(entry => [entry.mapId === 1 ? 'store.json' : `map-${entry.mapId}.json`, ...(entry.imageFile ? [entry.imageFile] : [])]));
  if (Object.keys(manifest.files).length !== expectedFiles.size || Object.keys(manifest.files).some(name => !expectedFiles.has(name))) {
    throw new Error('Backup manifest contains unexpected files');
  }
  const base = new URL(process.env.AISLE_URL ?? 'http://127.0.0.1:5173');
  if (!['http:', 'https:'].includes(base.protocol)) throw new Error('AISLE_URL must use HTTP or HTTPS');
  const get = async path => {
    const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return response.json();
  };
  const existing = await get('/api/maps');
  if (!Array.isArray(existing)) throw new Error('Invalid map list from server');
  const byId = new Map(existing.map(map => [map.mapId, map]));
  for (const entry of entries) {
    const current = byId.get(entry.mapId);
    if (current && current.name !== entry.name) throw new Error(`Map ${entry.mapId} is named differently on the server; restore aborted before changes.`);
  }
  let restored = 0;
  for (const entry of entries) {
    let targetId = entry.mapId;
    if (!byId.has(targetId)) {
      const response = await fetch(new URL('/api/maps', base), {
        method: 'POST', headers: { Origin: base.origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: entry.name }), signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error(`Cannot create map ${entry.name}: HTTP ${response.status}`);
      const created = await response.json();
      targetId = created.mapId;
      byId.set(targetId, created);
    }
    const current = await get(`/api/state?mapId=${targetId}`);
    const form = new FormData();
    form.set('state', JSON.stringify({ ...entry.state, revision: current.revision, mapId: targetId }));
    if (entry.image) {
      const extension = entry.imageFile.slice(entry.imageFile.lastIndexOf('.') + 1);
      form.set('image', new Blob([entry.image], { type: types[extension] }), entry.imageFile);
    }
    const response = await fetch(new URL(`/api/restore?mapId=${targetId}`, base), {
      method: 'POST', headers: { Origin: base.origin, 'X-Restore-Token': token },
      body: form, signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`Map ${entry.name}: restore failed (HTTP ${response.status}): ${await response.text()}`);
    restored++;
    console.log(`Restored ${entry.name} (${entry.mapId} -> ${targetId}).`);
  }
  console.log(`Restored ${restored} maps. Reload the app.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
