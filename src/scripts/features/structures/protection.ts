import { world } from '@minecraft/server';

type ProtectedRegion = {
  id: string;
  dimension: string;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
};

const PROPERTY = 'spb:structure_protections';
const MAX_REGIONS = 100;

function readRegions(): ProtectedRegion[] {
  const value = world.getDynamicProperty(PROPERTY);
  if (typeof value !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRegion).slice(-MAX_REGIONS);
  } catch {
    return [];
  }
}

function isRegion(value: unknown): value is ProtectedRegion {
  if (!value || typeof value !== 'object') return false;
  const region = value as Record<string, unknown>;
  return (
    typeof region.id === 'string' &&
    typeof region.dimension === 'string' &&
    ['minX', 'maxX', 'minY', 'maxY', 'minZ', 'maxZ'].every(
      (key) => typeof region[key] === 'number' && Number.isInteger(region[key])
    )
  );
}

function contains(region: ProtectedRegion, dimension: string, location: { x: number; y: number; z: number }) {
  return (
    region.dimension === dimension &&
    location.x >= region.minX &&
    location.x <= region.maxX &&
    location.y >= region.minY &&
    location.y <= region.maxY &&
    location.z >= region.minZ &&
    location.z <= region.maxZ
  );
}

export function isStructureProtected(
  dimension: string,
  location: { x: number; y: number; z: number }
): boolean {
  return readRegions().some((region) => contains(region, dimension, location));
}

/**
 * A placement protection is intentionally a cuboid: it remains reliable after
 * rotation/mirroring and survives restarts without storing every individual
 * block of a potentially huge structure.
 */
export function protectStructurePlacement(region: ProtectedRegion): void {
  const regions = readRegions().filter((current) => current.id !== region.id);
  regions.push(region);
  world.setDynamicProperty(PROPERTY, JSON.stringify(regions.slice(-MAX_REGIONS)));
}

world.beforeEvents.playerBreakBlock.subscribe((event) => {
  if (isStructureProtected(event.dimension.id, event.block.location)) event.cancel = true;
});

world.beforeEvents.explosion.subscribe((event) => {
  event.setImpactedBlocks(
    event.getImpactedBlocks().filter(
      (block) => !isStructureProtected(event.dimension.id, block.location)
    )
  );
});
