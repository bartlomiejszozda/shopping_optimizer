import { readStore, writeStore, normalizeName, validName, validProduct, errorResponse, sameOrigin, type Product } from '@/lib/store';

export async function GET() {
  try { return Response.json(await readStore(), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return errorResponse(error); }
}

export async function PUT(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: 'Invalid request origin' }, { status: 403 });
  try {
    const body = await request.json() as { revision?: number; products?: Product[]; shoppingList?: string[] };
    if (!Number.isInteger(body.revision) || (body.revision ?? -1) < 0 || !Array.isArray(body.products) || body.products.length > 1000 || !body.products.every(validProduct) || !Array.isArray(body.shoppingList) || body.shoppingList.length > 300 || !body.shoppingList.every(validName)) {
      return Response.json({ error: 'Invalid store data' }, { status: 400 });
    }
    const productIds = new Set(body.products.map(product => product.id));
    const productNames = new Set(body.products.map(product => normalizeName(product.name)));
    if (productIds.size !== body.products.length || productNames.size !== body.products.length) return Response.json({ error: 'Product names must be unique' }, { status: 400 });
    const current = await readStore();
    if (current.revision !== body.revision) return Response.json({ error: 'This store changed in another tab. Reload before saving.' }, { status: 409 });
    if (!current.map && body.products.some(product => product.x !== null)) return Response.json({ error: 'Upload a map before placing products' }, { status: 400 });
    const saved = await writeStore({ products: body.products.map(product => ({ ...product, name: product.name.trim().replace(/\s+/g, ' ') })), shoppingList: body.shoppingList.map(name => name.trim().replace(/\s+/g, ' ')), map: current.map }, current.revision);
    return saved ? Response.json(saved) : Response.json({ error: 'This store changed in another tab. Reload before saving.' }, { status: 409 });
  } catch (error) { return errorResponse(error); }
}
