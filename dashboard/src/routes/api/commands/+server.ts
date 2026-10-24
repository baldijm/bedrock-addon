import type { RequestHandler } from './$types';
import { isAuthenticated, json, unauthorized } from '#lib/server/auth';
import { bridgeRequest } from '#lib/server/bridge';

const localLogs: { id: number; at: string; text: string }[] = [];

function isLocalDevelopment() {
	return import.meta.env.DEV && Boolean(process.env.CONSOLE_PASSWORD);
}

function localConsole() {
	if (localLogs.length === 0)
		localLogs.push({ id: Date.now(), at: new Date().toISOString(), text: '[Local] Console preview ready. No staging connection was made.' });
	return { health: { bedrockRunning: false, localDevelopment: true }, logs: { lines: localLogs } };
}

export const GET: RequestHandler = async ({ request }) => {
	if (!(await isAuthenticated(request))) return unauthorized();
	if (isLocalDevelopment()) return json(localConsole());
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
	if (isLocalDevelopment()) {
		localLogs.push({ id: Date.now(), at: new Date().toISOString(), text: `> ${command}` });
		return json({ ok: true, localDevelopment: true }, 202);
	}
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
