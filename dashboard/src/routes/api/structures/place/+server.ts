import type { RequestHandler } from './$types';
import { isAuthenticated, json, unauthorized } from '#lib/server/auth';
import { consoleBridgeRequest, type ServerEnvironment } from '#lib/server/bridge';
import { validateStructureName } from '#lib/server/structures';
import { resolveEnvironment } from '#lib/server/environment';

const ROTATIONS = new Set(['0_degrees', '90_degrees', '180_degrees', '270_degrees']);
const MIRRORS = new Set(['none', 'x', 'z', 'xz']);

function coordinate(value: unknown, axis: string) {
	if (
		!Number.isInteger(value) ||
		typeof value !== 'number' ||
		value < -29_999_984 ||
		value > 29_999_984
	)
		throw new Error(`La coordenada ${axis} no es válida.`);
	return value;
}

export const POST: RequestHandler = async ({ request }) => {
	if (!(await isAuthenticated(request))) return unauthorized();
	const environment: ServerEnvironment = resolveEnvironment(request);
	const body = await request.json().catch(() => null);
	try {
		if (!body || typeof body !== 'object') throw new Error('Solicitud inválida.');
		const name = validateStructureName(body.name);
		const x = coordinate(body.x, 'X');
		const y = coordinate(body.y, 'Y');
		const z = coordinate(body.z, 'Z');
		const rotation = ROTATIONS.has(body.rotation) ? body.rotation : '0_degrees';
		const mirror = MIRRORS.has(body.mirror) ? body.mirror : 'none';
		const expected = `spb:${name} @ ${x} ${y} ${z}`;
		if (body.confirmation !== expected)
			throw new Error(`Escribe exactamente ${expected} para confirmar.`);
		const result = await consoleBridgeRequest(environment, '/commands', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				command: `structure load spb:${name} ${x} ${y} ${z} ${rotation} ${mirror} true true`
			})
		});
		return json(
			{ ok: true, environment, command: `structure load spb:${name} ${x} ${y} ${z}`, result },
			202
		);
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'No se pudo colocar la estructura.' },
			400
		);
	}
};
