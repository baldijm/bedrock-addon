import { env } from 'cloudflare:workers';

const REPOSITORY = 'baldijm/bedrock-addon';
const BRANCH = 'main';
const DIRECTORY = 'BP/structures/spb';
const NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const MAX_STRUCTURE_BYTES = 20 * 1024 * 1024;

export type StructureEntry = { name: string; size: number; sha: string; path: string };

class GitHubError extends Error {
	constructor(
		message: string,
		readonly status: number
	) {
		super(message);
	}
}

function token() {
	return import.meta.env.DEV ? process.env.GITHUB_STRUCTURES_TOKEN : env.GITHUB_STRUCTURES_TOKEN;
}

function repository() {
	return (
		(import.meta.env.DEV
			? process.env.GITHUB_STRUCTURES_REPOSITORY
			: env.GITHUB_STRUCTURES_REPOSITORY) || REPOSITORY
	);
}

function branch() {
	return (
		(import.meta.env.DEV ? process.env.GITHUB_STRUCTURES_BRANCH : env.GITHUB_STRUCTURES_BRANCH) ||
		BRANCH
	);
}

function headers(extra: HeadersInit = {}) {
	const result = new Headers(extra);
	result.set('accept', 'application/vnd.github+json');
	result.set('x-github-api-version', '2026-03-10');
	result.set('user-agent', 'SPB-Structures-Dashboard');
	if (token()) result.set('authorization', `Bearer ${token()}`);
	return result;
}

function requireToken() {
	if (!token())
		throw new Error(
			'Falta configurar GITHUB_STRUCTURES_TOKEN para publicar estructuras en GitHub.'
		);
}

export function validateStructureName(value: unknown) {
	if (typeof value !== 'string' || !NAME.test(value))
		throw new Error(
			'El nombre debe usar minúsculas, números, guiones o guiones bajos (máximo 64 caracteres).'
		);
	return value;
}

function base64(bytes: Uint8Array) {
	let result = '';
	for (let offset = 0; offset < bytes.length; offset += 0x8000)
		result += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
	return btoa(result);
}

async function github(path: string, options: RequestInit = {}) {
	const response = await fetch(`https://api.github.com/repos/${repository()}${path}`, {
		...options,
		headers: headers(options.headers)
	});
	if (!response.ok) {
		const body = (await response.json().catch(() => ({}))) as { message?: string };
		throw new GitHubError(
			body.message || `GitHub rechazó la solicitud (${response.status}).`,
			response.status
		);
	}
	return response;
}

export async function listStructures(): Promise<StructureEntry[]> {
	let response: Response;
	try {
		response = await github(`/contents/${DIRECTORY}?ref=${encodeURIComponent(branch())}`);
	} catch (error) {
		// The library starts empty until its first structure is committed.
		if (error instanceof GitHubError && error.status === 404) return [];
		throw error;
	}
	const entries = (await response.json()) as Array<{
		type?: string;
		name?: string;
		size?: number;
		sha?: string;
		path?: string;
	}>;
	return entries
		.filter(
			(entry) =>
				entry.type === 'file' &&
				typeof entry.name === 'string' &&
				entry.name.endsWith('.mcstructure')
		)
		.map((entry) => ({
			name: entry.name!.slice(0, -'.mcstructure'.length),
			size: entry.size ?? 0,
			sha: entry.sha ?? '',
			path: entry.path ?? ''
		}))
		.sort((left, right) => left.name.localeCompare(right.name));
}

export async function readStructure(name: unknown) {
	const safeName = validateStructureName(name);
	const response = await github(
		`/contents/${DIRECTORY}/${encodeURIComponent(safeName)}.mcstructure?ref=${encodeURIComponent(branch())}`,
		{
			headers: { accept: 'application/vnd.github.raw' }
		}
	);
	return { name: safeName, bytes: new Uint8Array(await response.arrayBuffer()) };
}

export async function commitStructure(name: unknown, bytes: Uint8Array, source: string) {
	const safeName = validateStructureName(name);
	requireToken();
	if (!bytes.byteLength || bytes.byteLength > MAX_STRUCTURE_BYTES)
		throw new Error('La estructura debe medir entre 1 byte y 20 MiB.');
	const path = `${DIRECTORY}/${safeName}.mcstructure`;
	let sha: string | undefined;
	try {
		const current = await github(`/contents/${path}?ref=${encodeURIComponent(branch())}`);
		sha = ((await current.json()) as { sha?: string }).sha;
	} catch (error) {
		if (!(error instanceof GitHubError) || error.status !== 404) throw error;
	}
	const response = await github(`/contents/${path}`, {
		method: 'PUT',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			message: `structures: ${safeName} (${source})`,
			content: base64(bytes),
			branch: branch(),
			...(sha ? { sha } : {})
		})
	});
	const result = (await response.json()) as { commit?: { sha?: string; html_url?: string } };
	return {
		name: safeName,
		size: bytes.byteLength,
		commit: result.commit?.sha ?? '',
		url: result.commit?.html_url ?? ''
	};
}
