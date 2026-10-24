import type { RequestHandler } from './$types';
import { isAuthenticated, json, unauthorized } from '#lib/server/auth';
import { bridgeRequest } from '#lib/server/bridge';

export const GET: RequestHandler = async ({ request }) => {
	if (!(await isAuthenticated(request))) return unauthorized();
	try {
		const [status, configuration] = await Promise.all([
			bridgeRequest('production', '/world/promotion') as Promise<{ productionWorld?: string }>,
			bridgeRequest('production', '/properties') as Promise<{ properties?: { 'level-name'?: string } }>
		]);
		return json({ ...status, productionWorld: status.productionWorld ?? configuration.properties?.['level-name'] ?? '' });
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : 'No se pudo consultar la promoción.' }, 503);
	}
};

export const POST: RequestHandler = async ({ request }) => {
	if (!(await isAuthenticated(request))) return unauthorized();
	const body = await request.json().catch(() => null);
	if (!body || typeof body.confirmation !== 'string')
		return json({ error: 'Confirmación inválida.' }, 400);
	try {
		return json(await bridgeRequest('production', '/world/promotion', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ confirmation: body.confirmation })
		}), 202);
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : 'No se pudo iniciar la promoción.' }, 503);
	}
};
