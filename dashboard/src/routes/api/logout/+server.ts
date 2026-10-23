import type { RequestHandler } from './$types';
import { expiredSessionCookie, noStore } from '#lib/server/auth';

export const POST: RequestHandler = async () => {
	const headers = noStore();
	headers.append('set-cookie', expiredSessionCookie());
	return Response.json({ ok: true }, { headers });
};
