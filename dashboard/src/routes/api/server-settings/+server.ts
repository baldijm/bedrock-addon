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
	if (environment === 'production') {
		try {
			const [result, gameRules, worldState] = await Promise.all([
				bridgeRequest('production', '/properties') as Promise<{ properties?: typeof localProperties; activeProperties?: typeof localProperties }>,
				bridgeRequest('production', '/gamerules') as Promise<{ showCoordinates?: boolean; showDaysPlayed?: boolean }>,
				bridgeRequest('production', '/world-state') as Promise<{ world?: string; savedDifficulty?: string; savedGamemode?: string }>
			]);
			return json({ environment, readOnly: true, properties: result.properties ?? {}, activeProperties: result.activeProperties ?? result.properties ?? {}, gameRules, worldState });
		} catch (error) {
			return json({ environment, readOnly: true, error: error instanceof Error ? error.message : 'No se pudo leer la configuración de producción.' }, 503);
		}
	}
	if (isLocalDevelopment()) return json({ environment: 'local-development', properties: localProperties, activeProperties: localProperties, gameRules: { showCoordinates: false, showDaysPlayed: false }, hasPendingChanges: false, restartRequired: true });
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
	const showDaysPlayed = body.gameRules?.showDaysPlayed;
	if (showCoordinates !== undefined && typeof showCoordinates !== 'boolean')
		return json({ error: 'La opción de coordenadas no es válida.' }, 400);
	if (showDaysPlayed !== undefined && typeof showDaysPlayed !== 'boolean')
		return json({ error: 'La opción de días jugados no es válida.' }, 400);
	if (isLocalDevelopment()) return json({ ok: true, environment: 'local-development', changed: body.properties, restartRequired: true, gameRules: { showCoordinates, showDaysPlayed } });
	try {
		const properties = await bridgeRequest('staging', '/properties', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
		const gameRules = {
			...(typeof showCoordinates === 'boolean' ? { showCoordinates } : {}),
			...(typeof showDaysPlayed === 'boolean' ? { showDaysPlayed } : {})
		};
		if (Object.keys(gameRules).length) {
			await bridgeRequest('staging', '/gamerules', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(gameRules)
			});
		}
		return json({ ...properties, gameRules, gameRulesApplied: Object.keys(gameRules) });
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : 'No se pudo guardar la configuración de staging.' }, 503);
	}
};
