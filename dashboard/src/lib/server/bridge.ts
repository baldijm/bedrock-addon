import { env } from 'cloudflare:workers';

type BridgeOptions = RequestInit & { method?: 'GET' | 'POST' };
export type ServerEnvironment = 'staging' | 'production';

function bridgeConfiguration(environment: ServerEnvironment) {
	if (environment === 'production') {
		if (!env.PRODUCTION_OBSERVER_URL || !env.PRODUCTION_OBSERVER_TOKEN)
			throw new Error('El observador de producción todavía no está configurado.');
		return { base: env.PRODUCTION_OBSERVER_URL, token: env.PRODUCTION_OBSERVER_TOKEN };
	}
	if (!env.STAGING_BRIDGE_URL || !env.STAGING_BRIDGE_TOKEN)
		throw new Error('La consola de staging todavía no está configurada.');
	return { base: env.STAGING_BRIDGE_URL, token: env.STAGING_BRIDGE_TOKEN };
}

export async function bridgeRequest(environment: ServerEnvironment, path: string, options: BridgeOptions = {}) {
	const configuration = bridgeConfiguration(environment);
	const response = await fetch(`${configuration.base.replace(/\/+$/, '')}${path}`, {
		...options,
		headers: {
			Authorization: configuration.token,
			...(options.headers ?? {})
		}
	});
	const body = await response.json().catch(() => ({}));
	if (!response.ok) {
		const detail = typeof body?.error === 'string' ? body.error : 'El bridge no respondió correctamente.';
		throw new Error(detail);
	}
	return body;
}
