import type { RequestHandler } from './$types';
import { isAuthenticated, json, unauthorized } from '#lib/server/auth';
import { consoleBridgeRequest, consoleBridgeStreamRequest } from '#lib/server/bridge';
import { listStoredStructures, readStoredStructure } from '#lib/server/structure-library';
import { resolveEnvironment } from '#lib/server/environment';

/** Synchronize R2 templates before the staging-only Bedrock restart that indexes them. */
export const POST: RequestHandler = async ({ request }) => {
	if (!(await isAuthenticated(request))) return unauthorized();
	if (resolveEnvironment(request) !== 'staging')
		return json({ error: 'La activación de estructuras sólo está habilitada en Staging.' }, 409);
	try {
		const structures = await listStoredStructures();
		for (const entry of structures) {
			const stored = await readStoredStructure(entry.name);
			if (!stored) throw new Error(`La estructura ${entry.name} ya no está disponible en R2.`);
			await consoleBridgeStreamRequest('staging', '/structures/import', {
				method: 'POST',
				headers: {
					'content-type': 'application/octet-stream',
					'content-length': String(stored.entry.size),
					'x-spb-structure-id': `spb:${entry.name}`,
					'x-spb-structure-etag': stored.entry.etag
				},
				body: stored.object.body
			});
		}
		// The staging bridge owns Bedrock and starts it again after `stop`.
		await consoleBridgeRequest('staging', '/commands', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ command: 'stop' })
		});
		return json({ ok: true, structures: structures.length, restarting: true }, 202);
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'No se pudieron activar las estructuras.' },
			503
		);
	}
};
