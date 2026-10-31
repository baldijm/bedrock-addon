import type { RequestHandler } from './$types';
import { isAuthenticated, json, unauthorized } from '#lib/server/auth';
import { consoleBridgeRequest } from '#lib/server/bridge';
import { resolveEnvironment } from '#lib/server/environment';

function integer(value: unknown, label: string) {
	if (!Number.isInteger(value) || typeof value !== 'number')
		throw new Error(`${label} debe ser un número entero.`);
	return value;
}

export const POST: RequestHandler = async ({ request }) => {
	if (!(await isAuthenticated(request))) return unauthorized();
	const environment = resolveEnvironment(request);
	const body = await request.json().catch(() => null);
	try {
		if (environment !== 'staging')
			throw new Error('El borrador sólo está habilitado en Staging hasta completar su validación.');
		if (!body || typeof body !== 'object' || body.confirmed !== true)
			throw new Error('Confirma el borrado antes de continuar.');
		const x = integer(body.x, 'X');
		const y = integer(body.y, 'Y');
		const z = integer(body.z, 'Z');
		const width = integer(body.width, 'Ancho');
		const height = integer(body.height, 'Alto');
		const depth = integer(body.depth, 'Profundidad');
		if (
			width < 1 || width > 512 || height < 1 || height > 512 || depth < 1 || depth > 512 ||
			width * height * depth > 8_000_000
		) throw new Error('El área supera el límite seguro de 8,000,000 de bloques.');
		return json({
			ok: true,
			environment,
			result: await consoleBridgeRequest(environment, '/structures/erase', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ x, y, z, width, height, depth })
			})
		});
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'No se pudo borrar el área.' },
			400
		);
	}
};
