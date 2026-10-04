import { env } from 'cloudflare:workers';
import { upgradeStoreDocument } from './catalog';

export type Product = { id: string; name: string; categoryId: string | null; x: number | null; y: number | null };
export type Area = { x: number; y: number; width: number; height: number };
export type Category = { id: string; name: string; area: Area | null };
export type StoreData = { products: Product[]; categories: Category[]; shoppingList: string[]; map: { width: number; height: number; version: number; key?: string } | null };
export type StoreSnapshot = StoreData & { revision: number; mapId: number; name: string };

export const emptyStore: StoreData = { products: [], categories: [], shoppingList: [], map: null };

export function mapIdFromRequest(request: Request): number {
  const raw = new URL(request.url).searchParams.get('mapId');
  const id = raw === null ? 1 : Number(raw);
  if (!Number.isSafeInteger(id) || id < 1) throw new StoreRequestError('Invalid map ID', 400);
  return id;
}
class StoreRequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export async function listStores(): Promise<{ mapId: number; name: string }[]> {
  const result = await env.DB.prepare('SELECT id, document FROM store ORDER BY id').all<{ id: number; document: string }>();
  const maps = result.results.map(row => ({ mapId: row.id, name: JSON.parse(row.document).name ?? 'My store' }));
  return maps.some(map => map.mapId === 1) ? maps : [{ mapId: 1, name: 'My store' }, ...maps];
}
export async function createStore(name: string): Promise<StoreSnapshot> {
  // Reserve the legacy map even if it has never been saved.
  await env.DB.prepare('INSERT OR IGNORE INTO store (id, document, revision) VALUES (1, ?, 0)')
    .bind(JSON.stringify({ ...emptyStore, name: 'My store' })).run();
  const row = await env.DB.prepare('INSERT INTO store (document, revision) VALUES (?, 1) RETURNING id')
    .bind(JSON.stringify({ ...emptyStore, name })).first<{ id: number }>();
  if (!row) throw new Error('Could not create map');
  return { ...emptyStore, mapId: row.id, name, revision: 1 };
}
export async function readStore(mapId = 1): Promise<StoreSnapshot> {
  const db = env.DB;
  if (!db) throw new Error('Store database is unavailable');
  const row = await db.prepare('SELECT document, revision FROM store WHERE id = ?').bind(mapId).first<{ document: string; revision: number }>();
  if (!row) {
    if (mapId !== 1) throw new StoreRequestError('Map not found', 404);
    return { ...emptyStore, revision: 0, mapId, name: 'My store' };
  }
  const document = JSON.parse(row.document) as Partial<StoreData> & { name?: string };
  return { ...upgradeStoreDocument(document), revision: row.revision, mapId, name: document.name ?? 'My store' };
}

export async function writeStore(data: StoreData, expectedRevision: number, mapId = 1): Promise<StoreSnapshot | null> {
  const db = env.DB;
  if (!db) throw new Error('Store database is unavailable');
  const current = await readStore(mapId);
  const document = JSON.stringify({ ...data, name: current.name });
  if (expectedRevision === 0 && mapId === 1) {
    const inserted = await db.prepare('INSERT OR IGNORE INTO store (id, document, revision) VALUES (1, ?, 1)').bind(document).run();
    if (inserted.meta.changes === 1) return { ...data, revision: 1, mapId, name: current.name };
  }
  const result = await db.prepare('UPDATE store SET document = ?, revision = revision + 1 WHERE id = ? AND revision = ?').bind(document, mapId, expectedRevision).run();
  if (result.meta.changes !== 1) return null;
  return { ...data, revision: expectedRevision + 1, mapId, name: current.name };
}

export function validName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 100;
}
export function normalizeName(value: string): string { return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase(); }
export function validProduct(value: unknown): value is Product {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<Product>;
  return typeof item.id === 'string' && /^[0-9a-f-]{36}$/i.test(item.id) && validName(item.name)
    && (item.categoryId === null || typeof item.categoryId === 'string' && /^[0-9a-f-]{36}$/i.test(item.categoryId))
    && validCoordinates(item);
}
export function validCategory(value: unknown): value is Category {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<Category>;
  return typeof item.id === 'string' && /^[0-9a-f-]{36}$/i.test(item.id) && validName(item.name)
    && normalizeName(item.name) !== 'uncategorized' && (item.area === null || validArea(item.area));
}
function validArea(area: unknown): area is Area {
  if (!area || typeof area !== 'object') return false;
  const item = area as Partial<Area>;
  return [item.x, item.y, item.width, item.height].every(value => typeof value === 'number' && Number.isFinite(value))
    && item.x! >= 0 && item.y! >= 0 && item.width! >= 0.005 && item.height! >= 0.005
    && item.x! + item.width! <= 1.000001 && item.y! + item.height! <= 1.000001;
}
function validCoordinates(item: { x?: number | null; y?: number | null }) {
  return item.x === null && item.y === null || typeof item.x === 'number' && typeof item.y === 'number'
    && Number.isFinite(item.x) && Number.isFinite(item.y) && item.x >= 0 && item.x <= 1 && item.y >= 0 && item.y <= 1;
}
export function errorResponse(error: unknown): Response {
  if (error instanceof StoreRequestError) return Response.json({ error: error.message }, { status: error.status });
  console.error('Store request failed', error);
  return Response.json({ error: 'The store could not be saved or loaded. Please try again.' }, { status: 500 });
}
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  return !!origin && origin === new URL(request.url).origin;
}
