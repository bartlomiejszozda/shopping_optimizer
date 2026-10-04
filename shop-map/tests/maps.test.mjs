import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { readFileSync } from 'node:fs';

// Run the actual routes against SQLite and an in-memory R2 adapter, without Docker.
const database = new DatabaseSync(':memory:');
database.exec(readFileSync(new URL('../drizzle/0000_sturdy_shinobi_shaw.sql', import.meta.url), 'utf8'));
const images = new Map();
globalThis.__testEnv = {
  DB: { prepare(sql) {
    let args = [];
    const statement = database.prepare(sql);
    return {
      bind(...values) { args = values; return this; },
      async first() { return statement.get(...args) ?? null; },
      async all() { return { results: statement.all(...args) }; },
      async run() { return { meta: { changes: statement.run(...args).changes } }; },
    };
  } },
  BUCKET: {
    async get(key) { return images.get(key) ?? null; },
    async put(key, body, metadata) { images.set(key, { body, ...metadata }); },
    async delete(key) { images.delete(key); },
  },
};
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'cloudflare:workers') return { url: 'data:text/javascript,export const env = globalThis.__testEnv;', shortCircuit: true };
    if (specifier.startsWith('@/')) return { url: new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, shortCircuit: true };
    if (specifier === './catalog') return { url: new URL('../lib/catalog.ts', import.meta.url).href, shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith('.ts')) return { format: 'module', source: stripTypeScriptTypes(readFileSync(new URL(url), 'utf8'), { mode: 'transform' }), shortCircuit: true };
    return next(url, context);
  },
});
const store = await import('../lib/store.ts');
const states = await import('../app/api/state/route.ts');
const maps = await import('../app/api/maps/route.ts');
const pictures = await import('../app/api/map/route.ts');
const request = (path, body) => new Request(`http://localhost${path}`, body === undefined ? {} : {
  method: 'POST', headers: { origin: 'http://localhost', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const upload = (mapId, revision, byte = 1) => {
  const form = new FormData();
  form.set('image', new File([new Uint8Array([137, 80, 78, 71, byte])], 'map.png', { type: 'image/png' }));
  form.set('width', '100'); form.set('height', '100'); form.set('revision', String(revision));
  return pictures.POST(new Request(`http://localhost/api/map?mapId=${mapId}`, { method: 'POST', headers: { origin: 'http://localhost' }, body: form }));
};
beforeEach(() => { database.exec('DELETE FROM store'); images.clear(); });

test('legacy map, image, and products remain accessible', async () => {
  const legacy = { ...store.emptyStore, products: [{ id: crypto.randomUUID(), name: 'Milk', x: 0.2, y: 0.3, categoryId: null }], map: { width: 100, height: 100, version: 1 } };
  database.prepare('INSERT INTO store VALUES (1, ?, 7)').run(JSON.stringify(legacy));
  images.set('store-map', { body: new Uint8Array([1, 2]), httpMetadata: { contentType: 'image/png' } });
  assert.deepEqual((await store.readStore()).products, legacy.products);
  assert.equal((await pictures.GET(request('/api/map'))).status, 200);
  await store.createStore('Second shop');
  assert.equal((await store.readStore()).revision, 7);
  assert.deepEqual(await store.listStores(), [{ mapId: 1, name: 'My store' }, { mapId: 2, name: 'Second shop' }]);
});
test('creating maps before first save reserves the original map', async () => {
  const response = await maps.POST(request('/api/maps', { name: '  Second   shop ' }));
  assert.equal(response.status, 201);
  const created = await response.json();
  assert.equal(created.mapId, 2); assert.equal(created.name, 'Second shop');
  assert.ok(await store.writeStore({ ...store.emptyStore, shoppingList: ['Milk'] }, 0));
  assert.deepEqual((await store.readStore(2)).shoppingList, []);
});
test('state edits and revisions are isolated between maps', async () => {
  const second = await store.createStore('Second');
  const response = await states.PUT(new Request('http://localhost/api/state?mapId=2', {
    method: 'PUT', headers: { origin: 'http://localhost', 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...second, shoppingList: ['Bread'] }),
  }));
  assert.equal(response.status, 200);
  assert.deepEqual((await store.readStore(2)).shoppingList, ['Bread']);
  assert.deepEqual((await store.readStore(1)).shoppingList, []);
  assert.equal(await store.writeStore(store.emptyStore, second.revision, 2), null);
});
test('uploads and replacements never overwrite another map image', async () => {
  await store.createStore('Second');
  assert.equal((await upload(1, 0, 11)).status, 200);
  assert.equal((await upload(2, 1, 22)).status, 200);
  assert.equal((await upload(2, 2, 33)).status, 200);
  assert.deepEqual([...new Uint8Array(await (await pictures.GET(request('/api/map?mapId=1'))).arrayBuffer())], [137, 80, 78, 71, 11]);
  assert.deepEqual([...new Uint8Array(await (await pictures.GET(request('/api/map?mapId=2'))).arrayBuffer())], [137, 80, 78, 71, 33]);
  assert.equal((await upload(2, 1)).status, 409);
});
test('invalid or missing map IDs cannot fall back to editing the first map', async () => {
  for (const id of ['0', '-1', 'abc', '1.5']) assert.equal((await states.GET(request(`/api/state?mapId=${id}`))).status, 400);
  assert.equal((await states.GET(request('/api/state?mapId=99'))).status, 404);
  assert.equal((await upload(99, 0)).status, 404);
  assert.equal((await maps.POST(request('/api/maps', { name: ' ' }))).status, 400);
  assert.equal((await maps.POST(new Request('http://localhost/api/maps', { method: 'POST' }))).status, 403);
});
test('concurrent uploads keep the winning image and remove the conflicting image', async () => {
  await store.createStore('Second');
  const results = await Promise.all([upload(2, 1, 44), upload(2, 1, 55)]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const winning = await results.find(result => result.status === 200).json();
  assert.equal(images.size, 1);
  assert.ok(images.has(winning.map.key));
  assert.equal((await store.readStore(2)).map.key, winning.map.key);
});
test('backup exports every map and verifies checksums', async () => {
  const { mkdtemp, readdir, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { createHash } = await import('node:crypto');
  await store.createStore('Second');
  await upload(1, 0, 11); await upload(2, 1, 22);
  const directory = await mkdtemp(join(tmpdir(), 'aisle-backup-test-'));
  const originalFetch = globalThis.fetch;
  const originalDirectory = process.env.AISLE_BACKUP_DIR;
  process.env.AISLE_BACKUP_DIR = directory;
  globalThis.fetch = async url => {
    const req = new Request(url);
    const path = new URL(url).pathname;
    if (path === '/api/maps') return maps.GET();
    if (path === '/api/state') return states.GET(req);
    if (path === '/api/map') return pictures.GET(req);
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    await import('../scripts/backup-store.mjs');
    const destination = join(directory, (await readdir(directory))[0]);
    const manifest = JSON.parse(await readFile(join(destination, 'manifest.json'), 'utf8'));
    assert.equal(manifest.maps.length, 2);
    assert.equal(Object.keys(manifest.files).length, 4);
    for (const [name, checksum] of Object.entries(manifest.files)) {
      assert.equal(createHash('sha256').update(await readFile(join(destination, name))).digest('hex'), checksum);
    }
    assert.equal(JSON.parse(await readFile(join(destination, 'map-2.json'), 'utf8')).name, 'Second');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalDirectory === undefined) delete process.env.AISLE_BACKUP_DIR;
    else process.env.AISLE_BACKUP_DIR = originalDirectory;
    await rm(directory, { recursive: true, force: true });
  }
});
