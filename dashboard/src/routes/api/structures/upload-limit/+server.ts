import type { RequestHandler } from './$types';
import { isAuthenticated, json, unauthorized } from '#lib/server/auth';
import { setStructureUploadLimit } from '#lib/server/structure-library';

export const PUT: RequestHandler = async ({ request }) => {
	if (!(await isAuthenticated(request))) return unauthorized();
	try {
		const body = await request.json().catch(() => null);
		const maxBytes = await setStructureUploadLimit(body?.mebibytes);
		return json({ ok: true, maxBytes });
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'No se pudo guardar el límite.' },
			400
		);
	}
};
