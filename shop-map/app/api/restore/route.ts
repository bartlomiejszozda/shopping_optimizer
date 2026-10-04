import { env } from 'cloudflare:workers';
import { readStore, writeStore, mapIdFromRequest, normalizeName, validName, validProduct, validCategory, errorResponse, sameOrigin, type StoreSnapshot } from '@/lib/store';
import { productInCategory } from '@/lib/catalog';

export async function POST(request: Request) {
  if (!env.AISLE_RESTORE_TOKEN) return Response.json({ error: 'Restore is disabled. Configure AISLE_RESTORE_TOKEN.' }, { status: 503 });
  if (!sameOrigin(request) || request.headers.get('X-Restore-Token') !== env.AISLE_RESTORE_TOKEN) {
    return Response.json({ error: 'Restore is not authorized' }, { status: 403 });
  }
  try {
    const mapId = mapIdFromRequest(request);
    const form = await request.formData();
    const body = JSON.parse(String(form.get('state'))) as StoreSnapshot;
    if (body.mapId !== mapId || !Number.isInteger(body.revision) || body.revision < 0 ||
        !Array.isArray(body.products) || body.products.length > 1000 || !body.products.every(validProduct) ||
        !Array.isArray(body.categories) || body.categories.length > 200 || !body.categories.every(validCategory) ||
        !Array.isArray(body.shoppingList) || body.shoppingList.length > 300 || !body.shoppingList.every(validName)) {
      return Response.json({ error: 'Invalid store data' }, { status: 400 });
    }
    const productIds = new Set(body.products.map(product => product.id));
    const productNames = new Set(body.products.map(product => normalizeName(product.name)));
    const categoryIds = new Set(body.categories.map(category => category.id));
    const categoryNames = new Set(body.categories.map(category => normalizeName(category.name)));
    if (productIds.size !== body.products.length || productNames.size !== body.products.length || categoryIds.size !== body.categories.length || categoryNames.size !== body.categories.length) return Response.json({ error: 'Product and category names must be unique' }, { status: 400 });
    if (body.products.some(product => product.categoryId !== null && !categoryIds.has(product.categoryId))) return Response.json({ error: 'A product has an unknown category' }, { status: 400 });
    if (body.products.some(product => !productInCategory(product, body.categories))) return Response.json({ error: 'A product pin must be inside its category area' }, { status: 400 });

    const image = form.get('image');
    let bytes: Uint8Array | null = null;
    if (body.map !== null) {
      if (!body.map || !Number.isInteger(body.map.width) || !Number.isInteger(body.map.height) ||
          body.map.width < 32 || body.map.height < 32 || body.map.width > 10000 || body.map.height > 10000 ||
          !(image instanceof File) || image.size === 0 || image.size > 10 * 1024 * 1024) {
        return Response.json({ error: 'Invalid backup map' }, { status: 400 });
      }
      bytes = new Uint8Array(await image.arrayBuffer());
      const png = image.type === 'image/png' && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71;
      const jpg = image.type === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
      const webp = image.type === 'image/webp' && new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP';
      if (!png && !jpg && !webp) return Response.json({ error: 'Invalid backup image' }, { status: 400 });
    } else if (image || body.products.some(product => product.x !== null) || body.categories.some(category => category.area !== null)) {
      return Response.json({ error: 'Backup locations require a map' }, { status: 400 });
    }
    const current = await readStore(mapId);
    if (current.revision !== body.revision) return Response.json({ error: 'Store changed. Retry the restore.' }, { status: 409 });
    const key = `store-map-${mapId}-${crypto.randomUUID()}`;
    if (bytes && image instanceof File) {
      if (!env.BUCKET) throw new Error('Image storage is unavailable');
      await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: image.type } });
    }
    // Publish this map's image and document together; other maps are untouched.
    const saved = await writeStore({
      products: body.products, categories: body.categories, shoppingList: body.shoppingList,
      map: body.map ? { width: body.map.width, height: body.map.height, version: Date.now(), key } : null,
    }, current.revision, mapId);
    if (!saved) {
      if (bytes) await env.BUCKET?.delete(key);
      return Response.json({ error: 'Store changed. Retry the restore.' }, { status: 409 });
    }
    return Response.json(saved);
  } catch (error) { return errorResponse(error); }
}
