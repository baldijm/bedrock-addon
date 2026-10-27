import { env } from 'cloudflare:workers';

const REPOSITORY = 'baldijm/bedrock-addon';
const BRANCH = 'main';
const DIRECTORY = 'BP/structures/spb';
const NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const MAX_STRUCTURE_BYTES = 20 * 1024 * 1024;

export type StructureDimensions = { x: number; y: number; z: number };
export type StructureEntry = {
	name: string;
	size: number;
	sha: string;
	path: string;
	dimensions: StructureDimensions | null;
};

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
	if (!result.has('accept')) result.set('accept', 'application/vnd.github+json');
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

function requireBytes(bytes: Uint8Array, offset: number, length: number) {
	if (!Number.isSafeInteger(length) || length < 0 || offset + length > bytes.length)
		throw new Error('El archivo .mcstructure está incompleto o no tiene un NBT válido.');
}

function u16(bytes: Uint8Array, offset: number) {
	requireBytes(bytes, offset, 2);
	return bytes[offset] | (bytes[offset + 1] << 8);
}

function i32(bytes: Uint8Array, offset: number) {
	requireBytes(bytes, offset, 4);
	return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getInt32(0, true);
}

function nameAt(bytes: Uint8Array, offset: number) {
	const length = u16(bytes, offset);
	const start = offset + 2;
	requireBytes(bytes, start, length);
	return { value: new TextDecoder().decode(bytes.subarray(start, start + length)), next: start + length };
}

function skipNbtPayload(bytes: Uint8Array, type: number, offset: number): number {
	if (type === 1) return offset + 1;
	if (type === 2) return offset + 2;
	if (type === 3 || type === 5) return offset + 4;
	if (type === 4 || type === 6) return offset + 8;
	if (type === 7) return offset + 4 + i32(bytes, offset);
	if (type === 8) {
		const value = nameAt(bytes, offset);
		return value.next;
	}
	if (type === 9) {
		requireBytes(bytes, offset, 5);
		const childType = bytes[offset];
		const count = i32(bytes, offset + 1);
		if (count < 0) throw new Error('El archivo .mcstructure tiene una lista NBT inválida.');
		let cursor = offset + 5;
		for (let index = 0; index < count; index += 1) cursor = skipNbtPayload(bytes, childType, cursor);
		return cursor;
	}
	if (type === 10) {
		let cursor = offset;
		while (true) {
			requireBytes(bytes, cursor, 1);
			const childType = bytes[cursor++];
			if (childType === 0) return cursor;
			const child = nameAt(bytes, cursor);
			cursor = skipNbtPayload(bytes, childType, child.next);
		}
	}
	if (type === 11) return offset + 4 + i32(bytes, offset) * 4;
	if (type === 12) return offset + 4 + i32(bytes, offset) * 8;
	throw new Error('El archivo .mcstructure contiene un tipo NBT no compatible.');
}

/** Read the `size` triplet from Bedrock's little-endian NBT structure header. */
export function readStructureDimensions(bytes: Uint8Array): StructureDimensions {
	requireBytes(bytes, 0, 3);
	if (bytes[0] !== 10) throw new Error('El archivo no es una estructura Bedrock NBT válida.');
	let cursor = nameAt(bytes, 1).next;
	while (true) {
		requireBytes(bytes, cursor, 1);
		const type = bytes[cursor++];
		if (type === 0) break;
		const name = nameAt(bytes, cursor);
		cursor = name.next;
		if (name.value === 'size') {
			requireBytes(bytes, cursor, 5);
			if (type !== 9 || bytes[cursor] !== 3 || i32(bytes, cursor + 1) !== 3)
				throw new Error('La estructura no contiene dimensiones válidas.');
			const dimensions = {
				x: i32(bytes, cursor + 5),
				y: i32(bytes, cursor + 9),
				z: i32(bytes, cursor + 13)
			};
			if (Object.values(dimensions).some((value) => value < 1 || value > 2048))
				throw new Error('Las dimensiones de la estructura no son seguras.');
			return dimensions;
		}
		cursor = skipNbtPayload(bytes, type, cursor);
	}
	throw new Error('La estructura no incluye el campo de dimensiones.');
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
	const structures = entries
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
			path: entry.path ?? '',
			dimensions: null
		}))
		.sort((left, right) => left.name.localeCompare(right.name));
	return Promise.all(
		structures.map(async (structure) => {
			try {
				return { ...structure, dimensions: await readStructureHeader(structure.name) };
			} catch {
				// A library entry can still be downloaded even if a third-party file is malformed.
				return structure;
			}
		})
	);
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

async function readStructureHeader(name: unknown) {
	const safeName = validateStructureName(name);
	const response = await github(
		`/contents/${DIRECTORY}/${encodeURIComponent(safeName)}.mcstructure?ref=${encodeURIComponent(branch())}`,
		{ headers: { accept: 'application/vnd.github.raw', range: 'bytes=0-63' } }
	);
	return readStructureDimensions(new Uint8Array(await response.arrayBuffer()));
}

export async function describeStructure(name: unknown) {
	const safeName = validateStructureName(name);
	return { name: safeName, dimensions: await readStructureHeader(safeName) };
}

export async function commitStructure(name: unknown, bytes: Uint8Array, source: string) {
	const safeName = validateStructureName(name);
	requireToken();
	if (!bytes.byteLength || bytes.byteLength > MAX_STRUCTURE_BYTES)
		throw new Error('La estructura debe medir entre 1 byte y 20 MiB.');
	const dimensions = readStructureDimensions(bytes);
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
		dimensions,
		commit: result.commit?.sha ?? '',
		url: result.commit?.html_url ?? ''
	};
}
