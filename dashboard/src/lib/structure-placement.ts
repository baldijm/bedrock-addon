export type StructureDimensions = { x: number; y: number; z: number };
export type StructureRotation = '0_degrees' | '90_degrees' | '180_degrees' | '270_degrees';
export type StructureMirror = 'none' | 'x' | 'z' | 'xz';
export type StructureAnchor = 'center' | 'origin';

type HorizontalBounds = { minX: number; maxX: number; minZ: number; maxZ: number };

/**
 * Returns the horizontal footprint relative to Bedrock's native structure origin.
 * This intentionally mirrors the bridge calculation so the dashboard preview and
 * the temporary ticking area cover exactly the same blocks.
 */
export function horizontalBounds(
	dimensions: StructureDimensions,
	rotation: StructureRotation,
	mirror: StructureMirror
): HorizontalBounds {
	const corners: Array<[number, number]> = [
		[0, 0],
		[dimensions.x - 1, 0],
		[0, dimensions.z - 1],
		[dimensions.x - 1, dimensions.z - 1]
	];
	const transformed = corners.map(([initialX, initialZ]) => {
		let localX = mirror === 'x' || mirror === 'xz' ? -initialX : initialX;
		let localZ = mirror === 'z' || mirror === 'xz' ? -initialZ : initialZ;
		if (rotation === '90_degrees') [localX, localZ] = [-localZ, localX];
		else if (rotation === '180_degrees') [localX, localZ] = [-localX, -localZ];
		else if (rotation === '270_degrees') [localX, localZ] = [localZ, -localX];
		return { x: localX, z: localZ };
	});
	return {
		minX: Math.min(...transformed.map((corner) => corner.x)),
		maxX: Math.max(...transformed.map((corner) => corner.x)),
		minZ: Math.min(...transformed.map((corner) => corner.z)),
		maxZ: Math.max(...transformed.map((corner) => corner.z))
	};
}

/** Convert a user-selected centre or native origin to Bedrock's native origin. */
export function resolveStructureOrigin(
	position: { x: number; y: number; z: number },
	dimensions: StructureDimensions,
	rotation: StructureRotation,
	mirror: StructureMirror,
	anchor: StructureAnchor
) {
	if (anchor === 'origin') return position;
	const bounds = horizontalBounds(dimensions, rotation, mirror);
	return {
		x: position.x - Math.floor((bounds.minX + bounds.maxX) / 2),
		y: position.y,
		z: position.z - Math.floor((bounds.minZ + bounds.maxZ) / 2)
	};
}
