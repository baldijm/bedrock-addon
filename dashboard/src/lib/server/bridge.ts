import { env } from 'cloudflare:workers';

type BridgeOptions = RequestInit & { method?: 'GET' | 'POST' };

function bridgeUrl(path: string) {
	const base = env.STAGING_BRIDGE_URL?.replace(/\/+$/, '');
	if (!base) throw new Error('La consola de staging todavía no está configurada.');
	return `${base}${path}`;
}

export async function bridgeRequest(path: string, options: BridgeOptions = {}) {
	const response = await fetch(bridgeUrl(path), {
		...options,
		headers: {
			Authorization: env.STAGING_BRIDGE_TOKEN,
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
