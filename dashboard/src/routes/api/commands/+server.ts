import type { RequestHandler } from './$types';
import { database, isAuthenticated, json, unauthorized } from '#lib/server/auth';

export const GET: RequestHandler = async ({ request }) => {
	if (!(await isAuthenticated(request))) return unauthorized();
	const result = await database()
		.prepare(
			'SELECT id, command, status, created_at AS createdAt, completed_at AS completedAt, result FROM commands ORDER BY created_at DESC LIMIT 40'
		)
		.all();
	return json({ commands: result.results });
};

export const POST: RequestHandler = async ({ request }) => {
	if (!(await isAuthenticated(request))) return unauthorized();
	const body = await request.json().catch(() => null);
	let command = typeof body?.command === 'string' ? body.command.trim() : '';
	command = command.replace(/^\/+/, '');
	if (!command || command.length > 512 || /[\r\n\0]/.test(command))
		return json({ error: 'El comando debe ocupar una sola línea de hasta 512 caracteres.' }, 400);
	const id = crypto.randomUUID();
	const now = new Date().toISOString();
	await database()
		.prepare(
			'INSERT INTO commands (id, environment, command, status, created_at) VALUES (?, ?, ?, ?, ?)'
		)
		.bind(id, 'staging', command, 'queued', now)
		.run();
	return json({ id, status: 'queued' }, 201);
};
