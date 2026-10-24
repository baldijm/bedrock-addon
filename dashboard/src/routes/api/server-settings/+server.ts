import type { RequestHandler } from './$types';
import { isAuthenticated, json, unauthorized } from '#lib/server/auth';
import { bridgeRequest } from '#lib/server/bridge';

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
	if (isLocalDevelopment()) return json({ environment: 'local-development', properties: localProperties, activeProperties: localProperties, hasPendingChanges: false, restartRequired: true });
	try {
		return json(await bridgeRequest('staging', '/properties'));
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : 'No se pudo leer la configuración de staging.' }, 503);
	}
};

export const PUT: RequestHandler = async ({ request }) => {
	if (!(await isAuthenticated(request))) return unauthorized();
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object' || !body.properties || typeof body.properties !== 'object')
		return json({ error: 'Configuración inválida.' }, 400);
	if (isLocalDevelopment()) return json({ ok: true, environment: 'local-development', changed: body.properties, restartRequired: true });
	try {
		return json(
			await bridgeRequest('staging', '/properties', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			})
		);
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : 'No se pudo guardar la configuración de staging.' }, 503);
	}
};
