import { env } from 'cloudflare:workers';
import { readStore, sameOrigin, validName, mapIdFromRequest } from '@/lib/store';

type DecisionResponse = {
  answers?: {
    category?: {
      type?: string;
      probabilities?: Record<string, number>;
    };
  };
};

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: 'Invalid request origin' }, { status: 403 });
  try {
    const body = await request.json() as { name?: unknown };
    if (!validName(body.name)) return Response.json({ error: 'Enter a product name of up to 100 characters.' }, { status: 400 });
    const categories = (await readStore(mapIdFromRequest(request))).categories;
    if (categories.length === 0) return Response.json({ suggestions: [], recommendedCategoryId: null }, { headers: { 'Cache-Control': 'no-store' } });
    if (!env.OPENROUTER_API_KEY) return Response.json({ error: 'Add OPENROUTER_API_KEY to .dev.vars to enable AI suggestions.' }, { status: 503 });

    // Stable, short option keys keep the model's answer separate from our database IDs.
    const options = Object.fromEntries(categories.map((category, index) =>
      [`category_${index}`, `The product belongs in the “${category.name}” store category.`]));
    const response = await fetch('https://openrouter.ai/api/alpha/decisions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'typesafe/jev-1.13',
        state: { product: body.name.trim() },
        questions: {
          category: {
            type: 'choice',
            instructions: 'Which existing store category best fits the grocery product in `product`? Understand product and category names in any language. Choose none if no category fits.',
            criteria: { ...options, none: 'No listed store category fits this product.' },
          },
        },
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      const failure = await response.json().catch(() => null) as { error?: { code?: unknown; message?: unknown } } | null;
      console.error('OpenRouter category suggestion request failed', {
        status: response.status,
        code: typeof failure?.error?.code === 'number' || typeof failure?.error?.code === 'string' ? failure.error.code : undefined,
      });
      if (response.status === 402) return Response.json({ error: 'OpenRouter needs credits to use Jev. Add credits or choose a category manually.' }, { status: 503 });
      return Response.json({ error: 'AI suggestions are unavailable. Choose a category manually.' }, { status: 502 });
    }

    const result = await response.json() as DecisionResponse;
    const answer = result.answers?.category;
    const probabilities = answer?.probabilities;
    if (answer?.type !== 'choice' || !probabilities || typeof probabilities.none !== 'number' ||
      !Number.isFinite(probabilities.none) || probabilities.none < 0 || probabilities.none > 1 ||
      categories.some((_, index) => {
        const value = probabilities[`category_${index}`];
        return typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1;
      })) {
      return Response.json({ error: 'AI returned invalid category suggestions.' }, { status: 502 });
    }
    const ranked = categories.map((category, index) => ({
      categoryId: category.id,
      probability: probabilities[`category_${index}`],
    })).sort((a, b) => b.probability - a.probability);
    const recommendedCategoryId = ranked[0].probability > probabilities.none && ranked[0].probability > 0
      ? ranked[0].categoryId : null;
    const suggestions = ranked.slice(0, 5).map(({ categoryId, probability }) => ({
      categoryId,
      percentage: Math.round(probability * 1000) / 10,
    }));
    return Response.json({ suggestions, recommendedCategoryId }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') return Response.json({ error: 'AI suggestions timed out. Choose a category manually.' }, { status: 504 });
    console.error('Category suggestion failed', error);
    return Response.json({ error: 'AI suggestions are unavailable. Choose a category manually.' }, { status: 502 });
  }
}
