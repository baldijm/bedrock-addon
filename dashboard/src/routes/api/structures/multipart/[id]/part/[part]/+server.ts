import type { RequestHandler } from './$types';
import { isAuthenticated, json, unauthorized } from '#lib/server/auth';
import { uploadMultipartPart } from '#lib/server/structure-multipart';

export const PUT: RequestHandler = async ({ request, params }) => {
	if (!(await isAuthenticated(request))) return unauthorized();
	try {
		const part = Number(params.part);
		const uploaded = await uploadMultipartPart(
			params.id,
			part,
			request.body,
			request.headers.get('x-spb-part-size')
		);
		return json(uploaded);
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'No se pudo subir una parte.' },
			400
		);
	}
};
