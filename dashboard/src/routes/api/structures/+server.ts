import type { RequestHandler } from './$types';
import { isAuthenticated, json, noStore, unauthorized } from '#lib/server/auth';
import {
	commitStructure,
	listStructures,
	MAX_STRUCTURE_BYTES,
	readStructure,
	validateStructureName
} from '#lib/server/structures';

export const GET: RequestHandler = async ({ request, url }) => {
	if (!(await isAuthenticated(request))) return unauthorized();
	const download = url.searchParams.get('download');
	try {
		if (download) {
			const structure = await readStructure(download);
			const headers = noStore(new Headers());
			headers.set('content-type', 'application/octet-stream');
			headers.set('content-disposition', `attachment; filename="${structure.name}.mcstructure"`);
			return new Response(structure.bytes, { headers });
		}
		return json({ structures: await listStructures(), maxBytes: MAX_STRUCTURE_BYTES });
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'No se pudo consultar la biblioteca.' },
			503
		);
	}
};

export const POST: RequestHandler = async ({ request, url }) => {
	if (!(await isAuthenticated(request))) return unauthorized();
	try {
		const name = validateStructureName(url.searchParams.get('name'));
		const data = new Uint8Array(await request.arrayBuffer());
		const result = await commitStructure(name, data, 'importada desde dashboard');
		return json(
			{
				ok: true,
				...result,
				deployment: 'El commit quedó en GitHub. Staging se desplegará mediante el flujo existente.'
			},
			201
		);
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'No se pudo importar la estructura.' },
			400
		);
	}
};
