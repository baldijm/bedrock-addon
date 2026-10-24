import type { RequestHandler } from './$types';
import { isAuthenticated, json, unauthorized } from '#lib/server/auth';
import { bridgeRequest } from '#lib/server/bridge';
import { resolveEnvironment } from '#lib/server/environment';

function isLocalDevelopment() {
	return import.meta.env.DEV && Boolean(process.env.CONSOLE_PASSWORD);
}

export const GET: RequestHandler = async ({ request }) => {
	if (!(await isAuthenticated(request))) return unauthorized();
	if (resolveEnvironment(request) === 'production') return json({ state: 'unavailable', environment: 'production', readOnly: true });
	if (isLocalDevelopment()) return json({ state: 'idle', localDevelopment: true });
	try {
		return json(await bridgeRequest('staging', '/world/reset/status'));
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : 'No se pudo leer el estado del mundo.' }, 503);
	}
};

export const POST: RequestHandler = async ({ request }) => {
	if (!(await isAuthenticated(request))) return unauthorized();
	if (resolveEnvironment(request) === 'production') return json({ error: 'Producción está disponible sólo en lectura.' }, 403);
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') return json({ error: 'Solicitud inválida.' }, 400);
	if (isLocalDevelopment()) return json({ ok: true, localDevelopment: true, operation: 'local-preview' }, 202);
	try {
		return json(await bridgeRequest('staging', '/world/reset', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), 202);
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : 'No se pudo iniciar el reinicio del mundo.' }, 503);
	}
};
