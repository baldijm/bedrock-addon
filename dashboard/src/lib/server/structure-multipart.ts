import { env } from 'cloudflare:workers';
import { database } from '#lib/server/auth';
import { readStructureDimensions, validateStructureName } from '#lib/server/structures';
import {
	MAX_STRUCTURE_UPLOAD_BYTES,
	MIN_STRUCTURE_UPLOAD_BYTES,
	structureUploadLimit,
	type StoredStructure
} from '#lib/server/structure-library';

export const MULTIPART_PART_BYTES = 10 * 1024 * 1024;

type MultipartSession = {
	sessionId: string;
	name: string;
	sizeBytes: number;
	objectKey: string;
	uploadId: string;
};

type MultipartRow = {
	session_id: string;
	name: string;
	size_bytes: number;
	object_key: string;
	upload_id: string;
};

function asSession(row: MultipartRow): MultipartSession {
	return {
		sessionId: row.session_id,
		name: row.name,
		sizeBytes: row.size_bytes,
		objectKey: row.object_key,
		uploadId: row.upload_id
	};
}

function uploadSize(value: unknown) {
	if (
		typeof value !== 'number' ||
		!Number.isSafeInteger(value) ||
		value < MIN_STRUCTURE_UPLOAD_BYTES ||
		value > MAX_STRUCTURE_UPLOAD_BYTES
	)
		throw new Error('El tamaño del archivo no es válido.');
	return value;
}

async function session(id: string) {
	const row = await database()
		.prepare(
			'SELECT session_id, name, size_bytes, object_key, upload_id FROM structure_multipart_uploads WHERE session_id = ?'
		)
		.bind(id)
		.first<MultipartRow>();
	if (!row) throw new Error('La sesión de carga ya no existe. Selecciona el archivo nuevamente.');
	return asSession(row);
}

function expectedPartSize(entry: MultipartSession, partNumber: number) {
	const parts = Math.ceil(entry.sizeBytes / MULTIPART_PART_BYTES);
	if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > parts)
		throw new Error('El número de parte no es válido.');
	const start = (partNumber - 1) * MULTIPART_PART_BYTES;
	return Math.min(MULTIPART_PART_BYTES, entry.sizeBytes - start);
}

export async function beginMultipartStructure(name: unknown, size: unknown) {
	const safeName = validateStructureName(name);
	const sizeBytes = uploadSize(size);
	const limit = await structureUploadLimit();
	if (sizeBytes > limit)
		throw new Error(
			`La estructura excede el límite configurado de ${Math.floor(limit / 1024 / 1024)} MiB.`
		);
	const sessionId = crypto.randomUUID();
	const version = crypto.randomUUID();
	const objectKey = `structures/${safeName}/${version}.mcstructure`;
	const upload = await env.STRUCTURES.createMultipartUpload(objectKey, {
		httpMetadata: { contentType: 'application/octet-stream' },
		customMetadata: { name: safeName, version }
	});
	try {
		await database()
			.prepare(
				'INSERT INTO structure_multipart_uploads (session_id, name, size_bytes, object_key, upload_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'
			)
			.bind(sessionId, safeName, sizeBytes, objectKey, upload.uploadId, new Date().toISOString())
			.run();
	} catch (error) {
		await upload.abort();
		throw error;
	}
	return {
		sessionId,
		partBytes: MULTIPART_PART_BYTES,
		parts: Math.ceil(sizeBytes / MULTIPART_PART_BYTES)
	};
}

export async function uploadMultipartPart(
	sessionId: string,
	partNumber: number,
	body: ReadableStream<Uint8Array> | null,
	declaredSize: unknown
) {
	const entry = await session(sessionId);
	const expected = expectedPartSize(entry, partNumber);
	if (!body) throw new Error('No se recibió la parte del archivo.');
	if (Number(declaredSize) !== expected)
		throw new Error('La parte recibida no tiene el tamaño esperado.');
	const bytes = new Uint8Array(await new Response(body).arrayBuffer());
	if (bytes.byteLength !== expected)
		throw new Error('La parte recibida no coincide con el tamaño declarado.');
	const upload = env.STRUCTURES.resumeMultipartUpload(entry.objectKey, entry.uploadId);
	return upload.uploadPart(partNumber, bytes);
}

export async function completeMultipartStructure(
	sessionId: string,
	parts: Array<{ partNumber: number; etag: string }>
) {
	const entry = await session(sessionId);
	const expectedParts = Math.ceil(entry.sizeBytes / MULTIPART_PART_BYTES);
	if (
		!Array.isArray(parts) ||
		parts.length !== expectedParts ||
		parts.some(
			(part, index) =>
				!part || part.partNumber !== index + 1 || typeof part.etag !== 'string' || !part.etag
		)
	)
		throw new Error('No se recibieron todas las partes de la estructura.');
	const upload = env.STRUCTURES.resumeMultipartUpload(entry.objectKey, entry.uploadId);
	let object: R2Object | null = null;
	try {
		object = await upload.complete(parts);
		if (object.size !== entry.sizeBytes)
			throw new Error('El archivo ensamblado no coincide con el tamaño original.');
		const header = await env.STRUCTURES.get(entry.objectKey, {
			range: { offset: 0, length: 64 * 1024 }
		});
		if (!header) throw new Error('No se pudo leer la estructura recién guardada.');
		const dimensions = readStructureDimensions(new Uint8Array(await header.arrayBuffer()));
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
				entry.name,
				object.version,
				entry.objectKey,
				entry.sizeBytes,
				object.etag,
				dimensions.x,
				dimensions.y,
				dimensions.z,
				createdAt,
				'dashboard-r2-multipart'
			)
			.run();
		await database()
			.prepare('DELETE FROM structure_multipart_uploads WHERE session_id = ?')
			.bind(entry.sessionId)
			.run();
		return {
			name: entry.name,
			size: entry.sizeBytes,
			version: object.version,
			objectKey: entry.objectKey,
			etag: object.etag,
			dimensions,
			createdAt,
			source: 'dashboard-r2-multipart'
		} satisfies StoredStructure;
	} catch (error) {
		if (object) await env.STRUCTURES.delete(entry.objectKey);
		throw error;
	}
}

export async function abortMultipartStructure(sessionId: string) {
	const entry = await session(sessionId);
	await env.STRUCTURES.resumeMultipartUpload(entry.objectKey, entry.uploadId).abort();
	await database()
		.prepare('DELETE FROM structure_multipart_uploads WHERE session_id = ?')
		.bind(entry.sessionId)
		.run();
}
