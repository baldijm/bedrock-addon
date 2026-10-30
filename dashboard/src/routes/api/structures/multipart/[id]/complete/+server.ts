import type { RequestHandler } from './$types';
import { isAuthenticated, json, unauthorized } from '#lib/server/auth';
import { completeMultipartStructure } from '#lib/server/structure-multipart';

export const POST: RequestHandler = async ({ request, params }) => {
	if (!(await isAuthenticated(request))) return unauthorized();
	try {
		const body = (await request.json()) as { parts?: Array<{ partNumber: number; etag: string }> };
		const result = await completeMultipartStructure(params.id, body.parts ?? []);
		return json(
			{
				ok: true,
				...result,
				deployment: 'La versión se guardó de forma privada en R2. Todavía no altera ningún mundo.'
			},
			201
		);
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'No se pudo publicar la estructura.' },
			400
		);
	}
};
