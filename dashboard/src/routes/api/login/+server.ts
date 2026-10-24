import type { RequestHandler } from './$types';
import { isAuthenticated, json, login, noStore, sessionCookie } from '#lib/server/auth';

export const POST: RequestHandler = async ({ request }) => {
	if (await isAuthenticated(request)) return json({ ok: true, alreadyAuthenticated: true });
	const body = await request.json().catch(() => null);
	const session = await login(typeof body?.password === 'string' ? body.password : '');
	if (!session) return json({ error: 'Credenciales incorrectas.' }, 401);
	const headers = noStore();
	headers.append('set-cookie', sessionCookie(session));
	return Response.json({ ok: true }, { headers });
};
