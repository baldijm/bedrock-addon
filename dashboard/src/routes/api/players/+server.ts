import type { RequestHandler } from './$types';
import { isAuthenticated, json, unauthorized } from '#lib/server/auth';
import { bridgeRequest } from '#lib/server/bridge';

export const GET: RequestHandler = async ({ request }) => {
	if (!(await isAuthenticated(request))) return unauthorized();
	if (import.meta.env.DEV && process.env.CONSOLE_PASSWORD)
		return json({ online: null, capacity: null, players: [], source: 'local-development' });
	try {
		return json(await bridgeRequest('staging', '/players'));
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'No se pudo consultar a los jugadores.' },
			503
		);
	}
};
