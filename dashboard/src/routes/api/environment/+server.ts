import { json } from '#lib/server/auth';
import { ENVIRONMENT_COOKIE } from '#lib/server/environment';

export const POST = async ({ request }: { request: Request }) => {
	const body = await request.json().catch(() => null);
	if (body?.environment !== 'staging' && body?.environment !== 'production')
		return json({ error: 'Entorno inválido.' }, 400);
	const secure = import.meta.env.PROD ? '; Secure' : '';
	return new Response(JSON.stringify({ environment: body.environment }), {
		headers: {
			'content-type': 'application/json',
			'cache-control': 'no-store',
			'set-cookie': `${ENVIRONMENT_COOKIE}=${body.environment}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`
		}
	});
};
