import type { RequestHandler } from './$types';
import { isAuthenticated, json, unauthorized } from '#lib/server/auth';
import { bridgeRequest } from '#lib/server/bridge';

function isLocalDevelopment() {
	return import.meta.env.DEV && Boolean(process.env.CONSOLE_PASSWORD);
}

export const POST: RequestHandler = async ({ request }) => {
	if (!(await isAuthenticated(request))) return unauthorized();
	if (isLocalDevelopment()) return json({ ok: true, localDevelopment: true, changed: {}, restartRequired: false });
	try {
		return json(await bridgeRequest('staging', '/properties/cancel'));
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'No se pudieron descartar los cambios de staging.' },
			503
		);
	}
};
