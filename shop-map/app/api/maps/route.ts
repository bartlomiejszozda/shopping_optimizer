import { createStore, listStores, validName, sameOrigin, errorResponse } from '@/lib/store';

export async function GET() {
  try { return Response.json(await listStores(), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: 'Invalid request origin' }, { status: 403 });
  try {
    const body = await request.json() as { name?: unknown };
    if (!validName(body.name)) return Response.json({ error: 'Enter a map name of up to 100 characters.' }, { status: 400 });
    return Response.json(await createStore(body.name.trim().replace(/\s+/g, ' ')), { status: 201 });
  } catch (error) { return errorResponse(error); }
}
