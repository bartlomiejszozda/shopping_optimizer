import type { Area, Category, Product, StoreData } from './store';

type Point = { x: number; y: number };
export type AreaDrag =
  | { mode: 'draw'; start: Point }
  | { mode: 'move'; start: Point; original: Area }
  | { mode: 'resize'; start: Point; original: Area; edges: { left: boolean; right: boolean; top: boolean; bottom: boolean } };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function areaCenter(area: Area): Point {
  return { x: area.x + area.width / 2, y: area.y + area.height / 2 };
}

export function pointInArea(point: Point, area: Area): boolean {
  const epsilon = 1e-9;
  return point.x >= area.x - epsilon && point.x <= area.x + area.width + epsilon
    && point.y >= area.y - epsilon && point.y <= area.y + area.height + epsilon;
}

export function productInCategory(product: Product, categories: Category[]): boolean {
  if (product.categoryId === null || product.x === null || product.y === null) return true;
  const category = categories.find(item => item.id === product.categoryId);
  return !!category?.area && pointInArea({ x: product.x, y: product.y }, category.area);
}

export function placeProductInCategory(product: Product, categories: Category[], center = false): Product {
  if (product.categoryId === null) return product;
  const area = categories.find(item => item.id === product.categoryId)?.area;
  if (!area) return { ...product, x: null, y: null };
  if (center) return { ...product, ...areaCenter(area) };
  if (product.x === null || product.y === null) return product;
  return { ...product,
    x: clamp(product.x, area.x, Math.min(1, area.x + area.width)),
    y: clamp(product.y, area.y, Math.min(1, area.y + area.height)),
  };
}

type LegacyCategory = Category & { x?: number | null; y?: number | null };
export function areaFromPoints(start: { x: number; y: number }, end: { x: number; y: number }): Area {
  const x = Math.min(Math.min(start.x, end.x), 0.995);
  const y = Math.min(Math.min(start.y, end.y), 0.995);
  return { x, y, width: Math.min(1 - x, Math.max(0.005, Math.abs(start.x - end.x))),
    height: Math.min(1 - y, Math.max(0.005, Math.abs(start.y - end.y))) };
}
export function areaFromDrag(drag: AreaDrag, end: Point): Area {
  if (drag.mode === 'draw') return areaFromPoints(drag.start, end);
  const area = drag.original;
  if (drag.mode === 'move') return { ...area,
    x: clamp(area.x + end.x - drag.start.x, 0, 1 - area.width),
    y: clamp(area.y + end.y - drag.start.y, 0, 1 - area.height) };
  let left = area.x;
  let right = area.x + area.width;
  let top = area.y;
  let bottom = area.y + area.height;
  const dx = end.x - drag.start.x;
  const dy = end.y - drag.start.y;
  if (drag.edges.left) left = clamp(area.x + dx, 0, right - 0.005);
  if (drag.edges.right) right = clamp(area.x + area.width + dx, left + 0.005, 1);
  if (drag.edges.top) top = clamp(area.y + dy, 0, bottom - 0.005);
  if (drag.edges.bottom) bottom = clamp(area.y + area.height + dy, top + 0.005, 1);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function moveProductsWithArea(products: Product[], categoryId: string, before: Area, after: Area): Product[] {
  return products.map(product => {
    if (product.categoryId !== categoryId || product.x === null || product.y === null) return product;
    return { ...product,
      x: clamp(after.x + ((product.x - before.x) / before.width) * after.width, after.x, Math.min(1, after.x + after.width)),
      y: clamp(after.y + ((product.y - before.y) / before.height) * after.height, after.y, Math.min(1, after.y + after.height)),
    };
  });
}
function legacyPointArea(category: LegacyCategory): Area | null {
  if (typeof category.x !== 'number' || typeof category.y !== 'number') return null;
  return { x: Math.max(0, Math.min(0.92, category.x - 0.04)), y: Math.max(0, Math.min(0.92, category.y - 0.04)), width: 0.08, height: 0.08 };
}

export function upgradeStoreDocument(document: Partial<StoreData>): StoreData {
  const categories = (document.categories ?? []).map(category => ({ id: category.id, name: category.name, area: category.area ?? legacyPointArea(category as LegacyCategory) }));
  return {
    products: (document.products ?? []).map(product => placeProductInCategory({ ...product, categoryId: product.categoryId ?? null }, categories)),
    categories,
    shoppingList: document.shoppingList ?? [],
    map: document.map ?? null,
  };
}

export function productLocation(product: Product, categories: Category[]) {
  if (product.x !== null && product.y !== null) return { kind: 'point' as const, x: product.x, y: product.y, source: 'product' as const };
  const category = categories.find(item => item.id === product.categoryId);
  if (category?.area) return { kind: 'area' as const, area: category.area, source: 'category' as const };
  return null;
}

export function categoryName(product: Product, categories: Category[]) {
  return categories.find(item => item.id === product.categoryId)?.name ?? 'Uncategorized';
}
