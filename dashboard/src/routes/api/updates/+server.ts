import type { RequestHandler } from './$types';
import { isAuthenticated, json, unauthorized } from '#lib/server/auth';
import { consoleBridgeRequest, type ServerEnvironment } from '#lib/server/bridge';
import { resolveEnvironment } from '#lib/server/environment';

const FEED_URL = 'https://net-secondary.web.minecraft-services.net/api/v1.0/download/links';
const VERSION = /\/bedrock-server-([0-9]+(?:\.[0-9]+){2,3})\.zip$/;
const LOG_VERSION = /\bVersion:\s*([0-9]+(?:\.[0-9]+){2,3})\b/i;

async function officialRelease() {
	const response = await fetch(FEED_URL, {
		headers: { 'user-agent': 'SPB-Bedrock-Updater/1' },
		cf: { cacheTtl: 3600, cacheEverything: true }
	});
	if (!response.ok) throw new Error('Microsoft no respondió con la versión disponible.');
	const body = (await response.json()) as { result?: { links?: { downloadType?: string; downloadUrl?: string }[] } };
	const url = body.result?.links?.find((link) => link.downloadType === 'serverBedrockLinux')?.downloadUrl;
	const version = typeof url === 'string' ? url.match(VERSION)?.[1] : undefined;
	if (!url || !version) throw new Error('Microsoft no entregó un paquete Linux estable reconocible.');
	return { version, source: 'Microsoft', url };
}

export const GET: RequestHandler = async ({ request }) => {
	if (!(await isAuthenticated(request))) return unauthorized();
	const environment: ServerEnvironment = resolveEnvironment(request);
	try {
		if (environment === 'production') {
			const [official, logs] = await Promise.all([
				officialRelease(),
				consoleBridgeRequest('production', '/logs?after=0') as Promise<{ lines?: { text?: string }[] }>
			]);
			const installedVersion = [...(logs.lines ?? [])].reverse().map((line) => line.text?.match(LOG_VERSION)?.[1]).find(Boolean);
			return json({ environment, official, installedVersion, state: 'needs-maintenance', maintenanceRequired: true, updateAvailable: Boolean(installedVersion && installedVersion !== official.version) });
		}
		const [official, local] = await Promise.all([
			officialRelease(),
			consoleBridgeRequest(environment, '/updates/status') as Promise<{ installedVersion?: string; state?: string; error?: string; operation?: string }>
		]);
		return json({ environment, official, ...local, updateAvailable: Boolean(local.installedVersion && local.installedVersion !== official.version) });
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : 'No se pudo consultar las actualizaciones.' }, 503);
	}
};

export const POST: RequestHandler = async ({ request }) => {
	if (!(await isAuthenticated(request))) return unauthorized();
	const body = await request.json().catch(() => null);
	if (body?.confirmed !== true) return json({ error: 'Confirma la actualización antes de continuar.' }, 400);
	const environment = resolveEnvironment(request);
	if (environment === 'production')
		return json({ error: 'La actualización de producción requiere habilitar primero su canal de mantenimiento aislado.' }, 409);
	try {
		return json(await consoleBridgeRequest(environment, '/updates', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmed: true }) }), 202);
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : 'No se pudo iniciar la actualización.' }, 503);
	}
};
