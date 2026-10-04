import { createHash } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const baseUrl = process.env.AISLE_URL ?? 'http://127.0.0.1:5173';
const backupRoot = process.env.AISLE_BACKUP_DIR ?? join(process.cwd(), 'backups');
const extensionByType = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

async function get(path) {
  const response = await fetch(new URL(path, baseUrl), { cache: 'no-store', signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return response;
}

async function snapshot() {
  for (let attempt = 0; attempt < 3; attempt++) {
    const maps = await (await get('/api/maps')).json();
    const entries = [];
    for (const { mapId } of maps) {
      const state = await (await get(`/api/state?mapId=${mapId}`)).json();
      if (!Number.isInteger(state.revision) || !Array.isArray(state.products) ||
        !Array.isArray(state.categories) || !Array.isArray(state.shoppingList)) {
        throw new Error('The store API returned invalid data.');
      }
      let map = null;
      let mapName = null;
      if (state.map) {
        const response = await get(`/api/map?mapId=${mapId}`);
        const contentType = response.headers.get('content-type')?.split(';')[0]?.trim();
        const extension = extensionByType[contentType];
        if (!extension) throw new Error(`Unsupported map content type: ${contentType ?? 'missing'}`);
        map = Buffer.from(await response.arrayBuffer());
        if (map.length === 0 || map.length > 10 * 1024 * 1024) throw new Error('The map image is empty or too large.');
        mapName = mapId === 1 ? `store-map.${extension}` : `map-${mapId}.${extension}`;
      }
      entries.push({ state, map, mapName, stateName: mapId === 1 ? 'store.json' : `map-${mapId}.json` });
    }
    let unchanged = JSON.stringify(await (await get('/api/maps')).json()) === JSON.stringify(maps);
    for (const { state } of entries) {
      const latest = await (await get(`/api/state?mapId=${state.mapId}`)).json();
      if (latest.revision !== state.revision) unchanged = false;
    }
    if (unchanged) return entries;
  }
  throw new Error('The maps changed during backup. Try again when edits are finished.');
}

const entries = await snapshot();
const state = entries[0].state;
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const name = `${stamp}-revision-${state.revision}`;
const temporary = join(backupRoot, `.${name}-${process.pid}.tmp`);
const destination = join(backupRoot, name);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

await mkdir(temporary, { recursive: true });
try {
  const files = {};
  for (const { state, map, mapName, stateName } of entries) {
    const bytes = Buffer.from(`${JSON.stringify(state, null, 2)}\n`);
    await writeFile(join(temporary, stateName), bytes, { flag: 'wx' });
    files[stateName] = sha256(bytes);
    if (map && mapName) {
      await writeFile(join(temporary, mapName), map, { flag: 'wx' });
      files[mapName] = sha256(map);
    }
  }
  const manifest = {
    createdAt: new Date().toISOString(),
    maps: entries.map(({ state, stateName, mapName }) => ({ mapId: state.mapId, name: state.name, revision: state.revision, stateFile: stateName, imageFile: mapName })),
    files,
  };
  await writeFile(join(temporary, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  await rename(temporary, destination);
  console.log(`Saved ${destination} (${entries.length} maps).`);
} catch (error) {
  await rm(temporary, { recursive: true, force: true });
  throw error;
}
