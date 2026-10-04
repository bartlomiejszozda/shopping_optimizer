import { env } from 'cloudflare:workers';
import { readStore, writeStore, errorResponse, sameOrigin } from '@/lib/store';

const mapKey = 'store-map';
export async function GET() {
  try {
    const map = await env.BUCKET?.get(mapKey);
    if (!map) return new Response(null, { status: 404 });
    return new Response(map.body, { headers: { 'Content-Type': map.httpMetadata?.contentType ?? 'image/png', 'Cache-Control': 'no-store' } });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: 'Invalid request origin' }, { status: 403 });
  try {
    if (!env.BUCKET) throw new Error('Image storage is unavailable');
    const form = await request.formData();
    const file = form.get('image');
    const width = Number(form.get('width'));
    const height = Number(form.get('height'));
    const revision = Number(form.get('revision'));
    if (!(file instanceof File) || file.size === 0 || file.size > 10 * 1024 * 1024 || !['image/png','image/jpeg','image/webp'].includes(file.type) || !Number.isInteger(width) || !Number.isInteger(height) || width < 32 || height < 32 || width > 10000 || height > 10000 || !Number.isInteger(revision) || revision < 0) {
      return Response.json({ error: 'Choose a PNG, JPG or WebP image up to 10 MB.' }, { status: 400 });
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const png = bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71;
    const jpg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    const webp = new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP';
    if (!(file.type === 'image/png' && png || file.type === 'image/jpeg' && jpg || file.type === 'image/webp' && webp)) return Response.json({ error: 'This file does not look like a supported image.' }, { status: 400 });
    const current = await readStore();
    if (current.revision !== revision) return Response.json({ error: 'This store changed in another tab. Reload before uploading.' }, { status: 409 });
    await env.BUCKET.put(mapKey, bytes, { httpMetadata: { contentType: file.type } });
    const saved = await writeStore({
      products: current.products.map(product => ({ ...product, x: null, y: null })),
      categories: current.categories.map(category => ({ ...category, area: null })),
      shoppingList: current.shoppingList, map: { width, height, version: Date.now() },
    }, revision);
    return saved ? Response.json(saved) : Response.json({ error: 'This store changed in another tab. Reload before uploading.' }, { status: 409 });
  } catch (error) { return errorResponse(error); }
}
