import type { RequestHandler } from './$types';
import { isAuthenticated, json, noStore, unauthorized } from '#lib/server/auth';
import { listStructures, readStructure, validateStructureName } from '#lib/server/structures';
import {
	listStoredStructures,
	readStoredStructure,
	storeStructure,
	structureUploadLimit
} from '#lib/server/structure-library';

async function library() {
	const [legacy, stored] = await Promise.all([listStructures(), listStoredStructures()]);
	const current = new Map(
		legacy.map((entry) => [entry.name, { ...entry, source: 'github' as const }])
	);
	for (const entry of stored)
		current.set(entry.name, {
			name: entry.name,
			size: entry.size,
			sha: entry.version,
			path: entry.objectKey,
			dimensions: entry.dimensions,
			source: 'r2' as const
		});
	return [...current.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export const GET: RequestHandler = async ({ request, url }) => {
	if (!(await isAuthenticated(request))) return unauthorized();
	const download = url.searchParams.get('download');
	try {
		if (download) {
			const stored = await readStoredStructure(download);
			const headers = noStore(new Headers());
			headers.set('content-type', 'application/octet-stream');
			headers.set(
				'content-disposition',
				`attachment; filename="${validateStructureName(download)}.mcstructure"`
			);
			if (stored) return new Response(stored.object.body, { headers });
			const legacy = await readStructure(download);
			return new Response(legacy.bytes, { headers });
		}
		return json({ structures: await library(), maxBytes: await structureUploadLimit() });
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
		const result = await storeStructure(name, request.body, request.headers.get('content-length'));
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
			{ error: error instanceof Error ? error.message : 'No se pudo importar la estructura.' },
			400
		);
	}
};
