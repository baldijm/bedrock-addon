import type { RequestHandler } from './$types';
import { isAuthenticated, json, unauthorized } from '#lib/server/auth';
import { bridgeRequest } from '#lib/server/bridge';

export const GET: RequestHandler = async ({ request }) => {
	if (!(await isAuthenticated(request))) return unauthorized();
	try {
		const [health, logs] = await Promise.all([bridgeRequest('/health'), bridgeRequest('/logs?after=0')]);
		return json({ health, logs });
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'No se pudo consultar la consola.' },
			503
		);
	}
};

export const POST: RequestHandler = async ({ request }) => {
	if (!(await isAuthenticated(request))) return unauthorized();
	const body = await request.json().catch(() => null);
	let command = typeof body?.command === 'string' ? body.command.trim() : '';
	command = command.replace(/^\/+/, '');
	if (!command || command.length > 512 || /[\r\n\0]/.test(command))
		return json({ error: 'El comando debe ocupar una sola línea de hasta 512 caracteres.' }, 400);
	try {
		const result = await bridgeRequest('/commands', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ command })
		});
		return json(result, 202);
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'No se pudo entregar el comando.' },
			503
		);
	}
};
