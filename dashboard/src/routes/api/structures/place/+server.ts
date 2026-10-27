import type { RequestHandler } from './$types';
import { isAuthenticated, json, unauthorized } from '#lib/server/auth';
import {
	consoleBridgeRequest,
	consoleBridgeStreamRequest,
	type ServerEnvironment
} from '#lib/server/bridge';
import { describeStructure, validateStructureName } from '#lib/server/structures';
import { describeStoredStructure, readStoredStructure } from '#lib/server/structure-library';
import { resolveEnvironment } from '#lib/server/environment';
import {
	resolveStructureOrigin,
	type StructureAnchor,
	type StructureMirror,
	type StructureRotation
} from '#lib/structure-placement';

const ROTATIONS = new Set(['0_degrees', '90_degrees', '180_degrees', '270_degrees']);
const MIRRORS = new Set(['none', 'x', 'z', 'xz']);
const ANCHORS = new Set(['center', 'origin']);
const PLACEMENT_MODES = new Set(['instant', 'layers']);

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
		const rotation = (
			ROTATIONS.has(body.rotation) ? body.rotation : '0_degrees'
		) as StructureRotation;
		const mirror = (MIRRORS.has(body.mirror) ? body.mirror : 'none') as StructureMirror;
		const mode = PLACEMENT_MODES.has(body.mode) ? body.mode : 'instant';
		const anchor = (ANCHORS.has(body.anchor) ? body.anchor : 'center') as StructureAnchor;
		const anchorLabel = anchor === 'center' ? 'centro' : 'origen';
		const expected = `spb:${name} (${anchorLabel}) @ ${x} ${y} ${z}`;
		if (body.confirmation !== expected)
			throw new Error(`Escribe exactamente ${expected} para confirmar.`);
		const stored = await describeStoredStructure(name);
		const structure = stored ?? (await describeStructure(name));
		const origin = resolveStructureOrigin(
			{ x, y, z },
			structure.dimensions,
			rotation,
			mirror,
			anchor
		);
		coordinate(origin.x, 'X de origen');
		coordinate(origin.y, 'Y de origen');
		coordinate(origin.z, 'Z de origen');
		let result: unknown;
		let confirmed = true;
		try {
			if (stored) {
				if (environment !== 'staging')
					throw new Error(
						'Esta estructura está en R2. Su colocación en producción se habilitará con el mantenimiento autorizado de ese bridge.'
					);
				const object = await readStoredStructure(name);
				if (!object) throw new Error('La estructura de R2 ya no está disponible.');
				try {
					await consoleBridgeStreamRequest('staging', '/structures/import', {
						method: 'POST',
						headers: {
							'content-type': 'application/octet-stream',
							'content-length': String(object.entry.size),
							'x-spb-structure-id': `spb:${name}`,
							'x-spb-structure-etag': object.entry.etag
						},
						body: object.object.body
					});
				} catch (uploadError) {
					const check = (await consoleBridgeRequest(
						'staging',
						`/structures/materialized?structure=${encodeURIComponent(`spb:${name}`)}&size=${object.entry.size}`
					)) as { ok?: boolean };
					if (!check.ok) throw uploadError;
				}
			}
			result = await consoleBridgeRequest(environment, '/structures/place', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					structure: `spb:${name}`,
					x: origin.x,
					y: origin.y,
					z: origin.z,
					rotation,
					mirror,
					mode,
					dimensions: structure.dimensions
				})
			});
		} catch (error) {
			// Production remains usable while its bridge awaits an explicitly authorized maintenance deployment.
			if (
				environment !== 'production' ||
				!(error instanceof Error) ||
				error.message !== 'No existe esa ruta.'
			)
				throw error;
			if (mode !== 'instant') {
				throw new Error(
					'La colocación capa por capa estará disponible en producción después de su mantenimiento autorizado.'
				);
			}
			confirmed = false;
			result = await consoleBridgeRequest(environment, '/commands', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					command: `structure load spb:${name} ${origin.x} ${origin.y} ${origin.z} ${rotation} ${mirror} true true`
				})
			});
		}
		return json({
			ok: true,
			environment,
			confirmed,
			anchor,
			mode,
			requested: { x, y, z },
			origin,
			command: `structure load spb:${name} ${origin.x} ${origin.y} ${origin.z}`,
			dimensions: structure.dimensions,
			result
		});
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'No se pudo colocar la estructura.' },
			400
		);
	}
};
