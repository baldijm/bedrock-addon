import { env } from 'cloudflare:workers';

type BridgeOptions = RequestInit & { method?: 'GET' | 'POST' };
export type ServerEnvironment = 'staging' | 'production';
type StreamingBridgeOptions = Omit<BridgeOptions, 'body'> & { body: ReadableStream<Uint8Array> };

function observerConfiguration(environment: ServerEnvironment) {
	if (environment === 'production') {
		if (!env.PRODUCTION_OBSERVER_URL || !env.PRODUCTION_OBSERVER_TOKEN)
			throw new Error('El observador de producción todavía no está configurado.');
		return { base: env.PRODUCTION_OBSERVER_URL, token: env.PRODUCTION_OBSERVER_TOKEN };
	}
	if (!env.STAGING_BRIDGE_URL || !env.STAGING_BRIDGE_TOKEN)
		throw new Error('La consola de staging todavía no está configurada.');
	return { base: env.STAGING_BRIDGE_URL, token: env.STAGING_BRIDGE_TOKEN };
}

async function request(
	configuration: { base: string; token: string },
	path: string,
	options: BridgeOptions = {}
) {
	const response = await fetch(`${configuration.base.replace(/\/+$/, '')}${path}`, {
		...options,
		headers: {
			Authorization: configuration.token,
			...(options.headers ?? {})
		}
	});
	const body = await response.json().catch(() => ({}));
	if (!response.ok) {
		const detail =
			typeof body?.error === 'string' ? body.error : 'El bridge no respondió correctamente.';
		throw new Error(detail);
	}
	return body;
}

async function streamingRequest(
	configuration: { base: string; token: string },
	path: string,
	options: StreamingBridgeOptions
) {
	const response = await fetch(`${configuration.base.replace(/\/+$/, '')}${path}`, {
		...options,
		headers: {
			Authorization: configuration.token,
			...(options.headers ?? {})
		}
	});
	const body = await response.json().catch(() => ({}));
	if (!response.ok) {
		const detail =
			typeof body?.error === 'string' ? body.error : 'El bridge no respondió correctamente.';
		throw new Error(detail);
	}
	return body;
}

export async function bridgeRequest(
	environment: ServerEnvironment,
	path: string,
	options: BridgeOptions = {}
) {
	return request(observerConfiguration(environment), path, options);
}

// Production uses the same authenticated hostname as its observer. Cloudflare Tunnel
// sends /world/promotion and /world-state to the observer; all other paths reach
// the console bridge that owns Bedrock's stdin/stdout.
export async function consoleBridgeRequest(
	environment: ServerEnvironment,
	path: string,
	options: BridgeOptions = {}
) {
	return request(observerConfiguration(environment), path, options);
}

/** Stream a private R2 object to the authenticated local bridge without buffering it in the Worker. */
export async function consoleBridgeStreamRequest(
	environment: ServerEnvironment,
	path: string,
	options: StreamingBridgeOptions
) {
	return streamingRequest(observerConfiguration(environment), path, options);
}
