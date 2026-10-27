import { env } from 'cloudflare:workers';
import { database } from '#lib/server/auth';
import {
	readStructureDimensions,
	type StructureDimensions,
	validateStructureName
} from '#lib/server/structures';

export const MIN_STRUCTURE_UPLOAD_BYTES = 1 * 1024 * 1024;
export const MAX_STRUCTURE_UPLOAD_BYTES = 100 * 1024 * 1024;
export const DEFAULT_STRUCTURE_UPLOAD_BYTES = 20 * 1024 * 1024;

export type StoredStructure = {
	name: string;
	size: number;
	version: string;
	objectKey: string;
	etag: string;
	dimensions: StructureDimensions;
	createdAt: string;
	source: string;
};

type StructureRow = {
	name: string;
	size_bytes: number;
	version: string;
	object_key: string;
	etag: string;
	dimensions_x: number;
	dimensions_y: number;
	dimensions_z: number;
	created_at: string;
	source: string;
};

function asStored(row: StructureRow): StoredStructure {
	return {
		name: row.name,
		size: row.size_bytes,
		version: row.version,
		objectKey: row.object_key,
		etag: row.etag,
		dimensions: { x: row.dimensions_x, y: row.dimensions_y, z: row.dimensions_z },
		createdAt: row.created_at,
		source: row.source
	};
}

function validLimit(value: unknown) {
	return (
		typeof value === 'number' &&
		Number.isInteger(value) &&
		value >= MIN_STRUCTURE_UPLOAD_BYTES &&
		value <= MAX_STRUCTURE_UPLOAD_BYTES
	);
}

export async function structureUploadLimit() {
	const row = await database()
		.prepare('SELECT max_upload_bytes FROM structure_upload_settings WHERE id = 1')
		.first<{ max_upload_bytes: number }>();
	return row && validLimit(row.max_upload_bytes)
		? row.max_upload_bytes
		: DEFAULT_STRUCTURE_UPLOAD_BYTES;
}

export async function setStructureUploadLimit(mebibytes: unknown) {
	if (
		typeof mebibytes !== 'number' ||
		!Number.isInteger(mebibytes) ||
		mebibytes < 1 ||
		mebibytes > 100
	)
		throw new Error('El límite debe ser un número entero entre 1 y 100 MiB.');
	const bytes = mebibytes * 1024 * 1024;
	await database()
		.prepare(
			`INSERT INTO structure_upload_settings (id, max_upload_bytes, updated_at)
			 VALUES (1, ?, ?)
			 ON CONFLICT(id) DO UPDATE SET max_upload_bytes = excluded.max_upload_bytes, updated_at = excluded.updated_at`
		)
		.bind(bytes, new Date().toISOString())
		.run();
	return bytes;
}

export async function listStoredStructures() {
	const result = await database()
		.prepare(
			`SELECT name, size_bytes, version, object_key, etag, dimensions_x, dimensions_y, dimensions_z, created_at, source
			 FROM structure_library ORDER BY name COLLATE NOCASE`
		)
		.all<StructureRow>();
	return result.results.map(asStored);
}

export async function storedStructure(name: unknown) {
	const safeName = validateStructureName(name);
	const row = await database()
		.prepare(
			`SELECT name, size_bytes, version, object_key, etag, dimensions_x, dimensions_y, dimensions_z, created_at, source
			 FROM structure_library WHERE name = ?`
		)
		.bind(safeName)
		.first<StructureRow>();
	return row ? asStored(row) : null;
}

function headerCollector(limit: number) {
	const captured: Uint8Array[] = [];
	let capturedBytes = 0;
	let totalBytes = 0;
	return {
		stream: new TransformStream<Uint8Array, Uint8Array>({
			transform(chunk, controller) {
				totalBytes += chunk.byteLength;
				if (totalBytes > limit)
					throw new Error(
						`La estructura excede el límite de ${(limit / 1024 / 1024).toFixed(0)} MiB.`
					);
				if (capturedBytes < 64 * 1024) {
					const slice = chunk.subarray(0, 64 * 1024 - capturedBytes);
					captured.push(slice.slice());
					capturedBytes += slice.byteLength;
				}
				controller.enqueue(chunk);
			}
		}),
		get size() {
			return totalBytes;
		},
		header() {
			const bytes = new Uint8Array(capturedBytes);
			let offset = 0;
			for (const part of captured) {
				bytes.set(part, offset);
				offset += part.byteLength;
			}
			return bytes;
		}
	};
}

export async function storeStructure(
	name: unknown,
	body: ReadableStream<Uint8Array> | null,
	declaredSizeHeader: string | null
) {
	const safeName = validateStructureName(name);
	const limit = await structureUploadLimit();
	if (!body) throw new Error('No se recibió el archivo de estructura.');
	const declaredSize = Number(declaredSizeHeader);
	if (!Number.isSafeInteger(declaredSize) || declaredSize < 1 || declaredSize > limit)
		throw new Error(
			`La estructura debe medir entre 1 byte y ${(limit / 1024 / 1024).toFixed(0)} MiB.`
		);
	const version = crypto.randomUUID();
	const objectKey = `structures/${safeName}/${version}.mcstructure`;
	const collector = headerCollector(limit);
	const fixed = new FixedLengthStream(declaredSize);
	try {
		const upload = env.STRUCTURES.put(objectKey, fixed.readable, {
			httpMetadata: { contentType: 'application/octet-stream' },
			customMetadata: { name: safeName, version }
		});
		const [, object] = await Promise.all([
			body.pipeThrough(collector.stream).pipeTo(fixed.writable),
			upload
		]);
		if (!collector.size) throw new Error('La estructura no puede estar vacía.');
		if (collector.size !== declaredSize)
			throw new Error('El archivo recibido no coincide con el tamaño declarado.');
		const dimensions = readStructureDimensions(collector.header());
		const createdAt = new Date().toISOString();
		await database()
			.prepare(
				`INSERT INTO structure_library (name, version, object_key, size_bytes, etag, dimensions_x, dimensions_y, dimensions_z, created_at, source)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				 ON CONFLICT(name) DO UPDATE SET version=excluded.version, object_key=excluded.object_key, size_bytes=excluded.size_bytes,
				 etag=excluded.etag, dimensions_x=excluded.dimensions_x, dimensions_y=excluded.dimensions_y, dimensions_z=excluded.dimensions_z,
				 created_at=excluded.created_at, source=excluded.source`
			)
			.bind(
				safeName,
				version,
				objectKey,
				declaredSize,
				object?.etag ?? '',
				dimensions.x,
				dimensions.y,
				dimensions.z,
				createdAt,
				'dashboard-r2'
			)
			.run();
		return {
			name: safeName,
			size: declaredSize,
			version,
			objectKey,
			etag: object?.etag ?? '',
			dimensions,
			createdAt,
			source: 'dashboard-r2'
		} satisfies StoredStructure;
	} catch (error) {
		await env.STRUCTURES.delete(objectKey);
		throw error;
	}
}

export async function readStoredStructure(name: unknown) {
	const entry = await storedStructure(name);
	if (!entry) return null;
	const object = await env.STRUCTURES.get(entry.objectKey);
	if (!object) throw new Error('La versión registrada no existe en R2.');
	return { entry, object };
}

export async function describeStoredStructure(name: unknown) {
	return storedStructure(name);
}

export async function storeStructureBytes(name: unknown, bytes: Uint8Array, source: string) {
	const safeName = validateStructureName(name);
	const limit = await structureUploadLimit();
	if (!bytes.byteLength || bytes.byteLength > limit)
		throw new Error(
			`La estructura debe medir entre 1 byte y ${(limit / 1024 / 1024).toFixed(0)} MiB.`
		);
	const dimensions = readStructureDimensions(bytes);
	const version = crypto.randomUUID();
	const objectKey = `structures/${safeName}/${version}.mcstructure`;
	try {
		const object = await env.STRUCTURES.put(objectKey, bytes, {
			httpMetadata: { contentType: 'application/octet-stream' },
			customMetadata: { name: safeName, version }
		});
		const createdAt = new Date().toISOString();
		await database()
			.prepare(
				`INSERT INTO structure_library (name, version, object_key, size_bytes, etag, dimensions_x, dimensions_y, dimensions_z, created_at, source)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				 ON CONFLICT(name) DO UPDATE SET version=excluded.version, object_key=excluded.object_key, size_bytes=excluded.size_bytes,
				 etag=excluded.etag, dimensions_x=excluded.dimensions_x, dimensions_y=excluded.dimensions_y, dimensions_z=excluded.dimensions_z,
				 created_at=excluded.created_at, source=excluded.source`
			)
			.bind(
				safeName,
				version,
				objectKey,
				bytes.byteLength,
				object?.etag ?? '',
				dimensions.x,
				dimensions.y,
				dimensions.z,
				createdAt,
				source
			)
			.run();
		return {
			name: safeName,
			size: bytes.byteLength,
			version,
			objectKey,
			etag: object?.etag ?? '',
			dimensions,
			createdAt,
			source
		} satisfies StoredStructure;
	} catch (error) {
		await env.STRUCTURES.delete(objectKey);
		throw error;
	}
}
