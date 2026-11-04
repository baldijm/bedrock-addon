import { validateArena as validateCanonicalArena, type Arena } from '../../../src/scripts/features/games/arenaSchema';
export { legacyArena } from '../../../src/scripts/features/games/arenaSchema';
export type { Arena, ArenaState, Point, Region } from '../../../src/scripts/features/games/arenaSchema';

/** The form accepts two opposite corners in either order on every axis. */
export function validateArena(input: unknown): Arena {
	if (!input || typeof input !== 'object') return validateCanonicalArena(input);
	const value = { ...input } as Record<string, unknown>;
	for (const key of ['bounds', 'goal1', 'goal2']) {
		const region = value[key] as { min?: Record<string, unknown>; max?: Record<string, unknown> } | undefined;
		if (!region?.min || !region.max) continue;
		const from = region.min;
		const to = region.max;
		const min = { ...from }, max = { ...to };
		for (const axis of ['x', 'y', 'z']) {
			if (typeof from[axis] === 'number' && typeof to[axis] === 'number') {
				min[axis] = Math.min(from[axis], to[axis]);
				max[axis] = Math.max(from[axis], to[axis]);
			}
		}
		value[key] = { min, max };
	}
	return validateCanonicalArena(value);
}
