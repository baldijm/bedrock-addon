import type { RequestHandler } from './$types';
import { isAuthenticated, json, unauthorized } from '#lib/server/auth';
import { bridgeRequest } from '#lib/server/bridge';
import { resolveEnvironment } from '#lib/server/environment';

function isLocalDevelopment() {
	return import.meta.env.DEV && Boolean(process.env.CONSOLE_PASSWORD);
}

export const POST: RequestHandler = async ({ request }) => {
	if (!(await isAuthenticated(request))) return unauthorized();
	const environment = resolveEnvironment(request);
	if (isLocalDevelopment()) return json({ ok: true, localDevelopment: true, restarting: false });
	try {
		if (environment === 'production') {
			const body = await request.json().catch(() => null);
			const current = await bridgeRequest('production', '/properties') as { properties?: Record<string, string>; hasPendingChanges?: boolean };
			const world = current.properties?.['level-name'];
			if (!world || body?.confirmation !== world)
				return json({ error: 'Escribe exactamente el nombre del mundo de producción para confirmar el reinicio.' }, 400);
			if (!current.hasPendingChanges)
				return json({ error: 'No hay cambios de propiedades pendientes en producción.' }, 409);
		}
		await bridgeRequest(environment, '/commands', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ command: 'stop' })
		});
		return json({ ok: true, environment, restarting: true }, 202);
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : `No se pudo iniciar el reinicio de ${environment}.` },
			503
		);
	}
};
