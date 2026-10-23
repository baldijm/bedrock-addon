import type { RequestHandler } from './$types';
import { database, hasServerToken, json, unauthorized } from '#lib/server/auth';

export const POST: RequestHandler = async ({ request, params }) => {
	if (!hasServerToken(request)) return unauthorized();
	if (!/^[0-9a-f-]{36}$/i.test(params.id)) return json({ error: 'Identificador inválido.' }, 400);
	const body = await request.json().catch(() => null);
	const result = typeof body?.result === 'string' ? body.result.slice(0, 4096) : '';
	const status = body?.ok === true ? 'completed' : 'failed';
	const update = await database()
		.prepare(
			"UPDATE commands SET status = ?, completed_at = ?, result = ? WHERE id = ? AND environment = 'staging' AND status = 'running'"
		)
		.bind(status, new Date().toISOString(), result, params.id)
		.run();
	if (update.meta.changes !== 1) return json({ error: 'Orden no disponible.' }, 404);
	return json({ ok: true });
};
