import type { RequestHandler } from './$types';
import { isAuthenticated, json, unauthorized } from '#lib/server/auth';
import { bridgeRequest } from '#lib/server/bridge';

function isLocalDevelopment() {
	return import.meta.env.DEV && Boolean(process.env.CONSOLE_PASSWORD);
}

export const POST: RequestHandler = async ({ request }) => {
	if (!(await isAuthenticated(request))) return unauthorized();
	if (isLocalDevelopment()) return json({ ok: true, localDevelopment: true, restarting: false });
	try {
		await bridgeRequest('staging', '/commands', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ command: 'stop' })
		});
		return json({ ok: true, environment: 'staging', restarting: true }, 202);
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'No se pudo iniciar el reinicio de staging.' },
			503
		);
	}
};
