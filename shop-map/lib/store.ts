import { env } from 'cloudflare:workers';
import { upgradeStoreDocument } from './catalog';

export type Product = { id: string; name: string; categoryId: string | null; x: number | null; y: number | null };
export type Area = { x: number; y: number; width: number; height: number };
export type Category = { id: string; name: string; area: Area | null };
export type StoreData = { products: Product[]; categories: Category[]; shoppingList: string[]; map: { width: number; height: number; version: number } | null };
export type StoreSnapshot = StoreData & { revision: number };

export const emptyStore: StoreData = { products: [], categories: [], shoppingList: [], map: null };

export async function readStore(): Promise<StoreSnapshot> {
  const db = env.DB;
  if (!db) throw new Error('Store database is unavailable');
  const row = await db.prepare('SELECT document, revision FROM store WHERE id = 1').first<{ document: string; revision: number }>();
  if (!row) return { ...emptyStore, revision: 0 };
  const document = JSON.parse(row.document) as Partial<StoreData>;
  return { ...upgradeStoreDocument(document), revision: row.revision };
}

export async function writeStore(data: StoreData, expectedRevision: number): Promise<StoreSnapshot | null> {
  const db = env.DB;
  if (!db) throw new Error('Store database is unavailable');
  const document = JSON.stringify(data);
  if (expectedRevision === 0) {
    const result = await db.prepare('INSERT OR IGNORE INTO store (id, document, revision) VALUES (1, ?, 1)').bind(document).run();
    if (result.meta.changes !== 1) return null;
    return { ...data, revision: 1 };
  }
  const result = await db.prepare('UPDATE store SET document = ?, revision = revision + 1 WHERE id = 1 AND revision = ?').bind(document, expectedRevision).run();
  if (result.meta.changes !== 1) return null;
  return { ...data, revision: expectedRevision + 1 };
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
  console.error('Store request failed', error);
  return Response.json({ error: 'The store could not be saved or loaded. Please try again.' }, { status: 500 });
}
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  return !!origin && origin === new URL(request.url).origin;
}
