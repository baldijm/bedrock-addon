import type { RequestHandler } from './$types';
import { database, hasServerToken, json, unauthorized } from '#lib/server/auth';

export const POST: RequestHandler = async ({ request }) => {
	if (!hasServerToken(request)) return unauthorized();
	const db = database();
	const next = await db
		.prepare(
			"SELECT id, command FROM commands WHERE environment = 'staging' AND status = 'queued' ORDER BY created_at ASC LIMIT 1"
		)
		.first<{ id: string; command: string }>();
	if (!next) return json({ command: null });
	const claim = await db
		.prepare(
			"UPDATE commands SET status = 'running', claimed_at = ? WHERE id = ? AND status = 'queued'"
		)
		.bind(new Date().toISOString(), next.id)
		.run();
	if (claim.meta.changes !== 1) return json({ command: null });
	return json({ command: next });
};
