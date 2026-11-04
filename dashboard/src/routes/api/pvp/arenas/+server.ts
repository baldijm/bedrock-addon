import type { RequestHandler } from './$types';
import { isAuthenticated, json, unauthorized } from '#lib/server/auth';
import { resolveEnvironment } from '#lib/server/environment';
import { consoleBridgeRequest } from '#lib/server/bridge';
import { arenaRequest } from '#lib/server/pvp-arenas';
import { validateArena } from '#lib/pvp-arenas';

export const GET: RequestHandler = async ({ request }) => {
	if (!(await isAuthenticated(request))) return unauthorized();
	const environment = resolveEnvironment(request);
	try {
		const [result, properties] = await Promise.all([
			arenaRequest(environment, { action: 'list' }),
			consoleBridgeRequest(environment, '/properties') as Promise<{ properties?: Record<string, string> }>
		]);
		return json({ ...result, environment, world: properties.properties?.['level-name'] ?? '' });
	} catch (error) { return json({ error: error instanceof Error ? error.message : 'No se pudieron consultar las arenas.' }, 503); }
};
export const POST: RequestHandler = async ({ request }) => {
	if (!(await isAuthenticated(request))) return unauthorized();
	const environment = resolveEnvironment(request);
	try {
		const raw = await request.text();
		if (raw.length > 8000) throw new Error('Solicitud demasiado grande.');
		const body = JSON.parse(raw);
		if (!body || !['save', 'activate', 'deactivate', 'delete'].includes(body.action) || !Number.isSafeInteger(body.revision))
			throw new Error('La operación no es válida.');
		if (environment === 'production') {
			const result = await consoleBridgeRequest(environment, '/properties') as { properties?: Record<string, string> };
			const world = result.properties?.['level-name'];
			if (!world || body.confirmation !== world) throw new Error('Escribe exactamente el nombre del mundo de Producción.');
		}
		const arena = body.action === 'save' ? validateArena(body.arena) : undefined;
		const result = await arenaRequest(environment, { action: body.action, revision: body.revision, id: body.id, arena });
		return json({ ...result, environment });
	} catch (error) { return json({ error: error instanceof Error ? error.message : 'No se pudo guardar la arena.' }, 400); }
};
