import type { RequestHandler } from './$types';
import { abortMultipartStructure } from '#lib/server/structure-multipart';
import { isAuthenticated, json, unauthorized } from '#lib/server/auth';

export const DELETE: RequestHandler = async ({ request, params }) => {
	if (!(await isAuthenticated(request))) return unauthorized();
	try {
		await abortMultipartStructure(params.id);
		return json({ ok: true });
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'No se pudo cancelar la carga.' },
			400
		);
	}
};
