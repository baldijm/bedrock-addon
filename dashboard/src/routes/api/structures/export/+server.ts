import type { RequestHandler } from './$types';
import { isAuthenticated, json, unauthorized } from '#lib/server/auth';
import { consoleBridgeRequest, type ServerEnvironment } from '#lib/server/bridge';
import {
	commitStructure,
	MAX_STRUCTURE_BYTES,
	validateStructureName
} from '#lib/server/structures';
import { resolveEnvironment } from '#lib/server/environment';

function decode(value: unknown) {
	if (typeof value !== 'string') throw new Error('El bridge no devolvió una estructura válida.');
	const raw = atob(value);
	const bytes = Uint8Array.from(raw, (character) => character.charCodeAt(0));
	if (!bytes.byteLength || bytes.byteLength > MAX_STRUCTURE_BYTES)
		throw new Error('La estructura excede el límite seguro de 20 MiB.');
	return bytes;
}

export const POST: RequestHandler = async ({ request }) => {
	if (!(await isAuthenticated(request))) return unauthorized();
	const environment: ServerEnvironment = resolveEnvironment(request);
	const body = await request.json().catch(() => null);
	try {
		if (!body || typeof body !== 'object') throw new Error('Solicitud inválida.');
		const target = validateStructureName(body.target);
		if (typeof body.source !== 'string')
			throw new Error('Indica el nombre guardado en el Structure Block.');
		const exported = (await consoleBridgeRequest(environment, '/structures/export', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ source: body.source })
		})) as { source?: string; content?: string };
		const result = await commitStructure(
			target,
			decode(exported.content),
			`exportada desde ${environment}: ${exported.source ?? body.source}`
		);
		return json(
			{
				ok: true,
				environment,
				source: exported.source,
				...result,
				deployment: 'El commit quedó en GitHub. Staging se desplegará mediante el flujo existente.'
			},
			201
		);
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'No se pudo exportar la estructura.' },
			400
		);
	}
};
