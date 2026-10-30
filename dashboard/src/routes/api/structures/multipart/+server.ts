import type { RequestHandler } from './$types';
import { isAuthenticated, json, unauthorized } from '#lib/server/auth';
import { beginMultipartStructure } from '#lib/server/structure-multipart';

export const POST: RequestHandler = async ({ request }) => {
	if (!(await isAuthenticated(request))) return unauthorized();
	try {
		const body = (await request.json()) as { name?: unknown; size?: unknown };
		return json(await beginMultipartStructure(body.name, body.size), 201);
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'No se pudo preparar la carga.' },
			400
		);
	}
};
