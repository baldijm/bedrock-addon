import type { RequestHandler } from './$types';
import { isAuthenticated, json, unauthorized } from '#lib/server/auth';
import {
	createStaticVariant,
	staticVariantCandidates
} from '#lib/server/static-structure-variants';

export const GET: RequestHandler = async ({ request, url }) => {
	if (!(await isAuthenticated(request))) return unauthorized();
	try {
		const source = url.searchParams.get('source');
		return json({ candidates: await staticVariantCandidates(source) });
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'No se pudo analizar la estructura.' },
			400
		);
	}
};

export const POST: RequestHandler = async ({ request }) => {
	if (!(await isAuthenticated(request))) return unauthorized();
	try {
		const body = (await request.json()) as { source?: unknown; target?: unknown; blocks?: unknown };
		return json({ ok: true, ...(await createStaticVariant(body.source, body.target, body.blocks)) }, 201);
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'No se pudo crear la variante estática.' },
			400
		);
	}
};
