import type { RequestHandler } from './$types';
import { isAuthenticated, json, unauthorized } from '#lib/server/auth';
import { bridgeRequest } from '#lib/server/bridge';
import { resolveEnvironment } from '#lib/server/environment';

const localProperties = {
	'server-name': 'SPB — staging local',
	'level-name': 'Bedrock level',
	'level-seed': '',
	gamemode: 'survival',
	difficulty: 'normal',
	'max-players': '10',
	'view-distance': '12',
	'tick-distance': '4',
	'allow-cheats': 'true',
	'allow-list': 'false',
	'default-player-permission-level': 'member',
	'player-idle-timeout': '0'
};

function isLocalDevelopment() {
	return import.meta.env.DEV && Boolean(process.env.CONSOLE_PASSWORD);
}

export const GET: RequestHandler = async ({ request }) => {
	if (!(await isAuthenticated(request))) return unauthorized();
	const environment = resolveEnvironment(request);
	if (environment === 'production') return json({ environment, readOnly: true, error: 'La configuración de producción todavía no se expone desde el observador.' });
	if (isLocalDevelopment()) return json({ environment: 'local-development', properties: localProperties, activeProperties: localProperties, gameRules: { showCoordinates: false }, hasPendingChanges: false, restartRequired: true });
	try {
		const [properties, gameRules] = await Promise.all([
			bridgeRequest('staging', '/properties'),
			bridgeRequest('staging', '/gamerules')
		]);
		return json({ ...properties, gameRules });
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : 'No se pudo leer la configuración de staging.' }, 503);
	}
};

export const PUT: RequestHandler = async ({ request }) => {
	if (!(await isAuthenticated(request))) return unauthorized();
	if (resolveEnvironment(request) === 'production') return json({ error: 'Producción está disponible sólo en lectura.' }, 403);
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object' || !body.properties || typeof body.properties !== 'object')
		return json({ error: 'Configuración inválida.' }, 400);
	const showCoordinates = body.gameRules?.showCoordinates;
	if (showCoordinates !== undefined && typeof showCoordinates !== 'boolean')
		return json({ error: 'La opción de coordenadas no es válida.' }, 400);
	if (isLocalDevelopment()) return json({ ok: true, environment: 'local-development', changed: body.properties, restartRequired: true, gameRules: { showCoordinates } });
	try {
		const properties = await bridgeRequest('staging', '/properties', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
		if (typeof showCoordinates === 'boolean') {
			await bridgeRequest('staging', '/gamerules', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ showCoordinates })
			});
		}
		return json({ ...properties, gameRules: { showCoordinates } });
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : 'No se pudo guardar la configuración de staging.' }, 503);
	}
};
