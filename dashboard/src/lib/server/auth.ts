import { env } from 'cloudflare:workers';

const encoder = new TextEncoder();
const COOKIE = 'spb_console_session';
const MAX_AGE_SECONDS = 60 * 60 * 12;

function equalBytes(left: Uint8Array, right: Uint8Array) {
	if (left.length !== right.length) return false;
	let difference = 0;
	for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
	return difference === 0;
}

function base64url(bytes: Uint8Array) {
	return btoa(String.fromCharCode(...bytes))
		.replaceAll('+', '-')
		.replaceAll('/', '_')
		.replaceAll('=', '');
}

function fromBase64url(value: string) {
	const padded =
		value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4);
	return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

async function sign(value: string) {
	const key = await crypto.subtle.importKey(
		'raw',
		encoder.encode(env.SESSION_SECRET),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	return base64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value))));
}

export function noStore(headers = new Headers()) {
	headers.set('cache-control', 'no-store');
	return headers;
}

export function json(data: unknown, status = 200) {
	return Response.json(data, { status, headers: noStore() });
}

export function unauthorized() {
	return json({ error: 'No autorizado.' }, 401);
}

export async function isAuthenticated(request: Request) {
	const value = request.headers
		.get('cookie')
		?.split(';')
		.map((part) => part.trim())
		.find((part) => part.startsWith(`${COOKIE}=`))
		?.slice(COOKIE.length + 1);
	if (!value) return false;
	const [expires, nonce, signature] = value.split('.');
	if (!expires || !nonce || !signature || Number(expires) < Date.now()) return false;
	const expected = await sign(`${expires}.${nonce}`);
	return (
		expected.length === signature.length &&
		equalBytes(fromBase64url(expected), fromBase64url(signature))
	);
}

export async function login(password: string) {
	if (!password || !equalBytes(encoder.encode(password), encoder.encode(env.ADMIN_PASSWORD)))
		return null;
	const expires = String(Date.now() + MAX_AGE_SECONDS * 1000);
	const nonce = crypto.randomUUID();
	const signature = await sign(`${expires}.${nonce}`);
	return `${expires}.${nonce}.${signature}`;
}

export function sessionCookie(value: string) {
	return `${COOKIE}=${value}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${MAX_AGE_SECONDS}`;
}

export function expiredSessionCookie() {
	return `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

export function hasServerToken(request: Request) {
	const given = request.headers.get('x-spb-console-token') ?? '';
	return (
		given.length === env.STAGING_SERVER_TOKEN.length &&
		equalBytes(encoder.encode(given), encoder.encode(env.STAGING_SERVER_TOKEN))
	);
}

export function database() {
	return env.DB;
}
