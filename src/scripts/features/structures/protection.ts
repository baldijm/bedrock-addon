import { BlockTypes, Direction, world } from '@minecraft/server';

type ProtectedRegion = {
  id: string;
  dimension: string;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  protectBreak?: boolean;
  protectPlace?: boolean;
  protectEnvironment?: boolean;
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
  return readRegions().some(
    (region) => region.protectBreak !== false && contains(region, dimension, location)
  );
}

function hasProtection(
  dimension: string,
  location: { x: number; y: number; z: number },
  permission: 'place' | 'environment'
): boolean {
  return readRegions().some((region) => {
    const protectedByRegion =
      permission === 'place'
        ? region.protectPlace === true
        : region.protectEnvironment !== false;
    return protectedByRegion && contains(region, dimension, location);
  });
}

const REPLACEABLE_BLOCKS = new Set([
  'minecraft:air',
  'minecraft:cave_air',
  'minecraft:void_air',
  'minecraft:short_grass',
  'minecraft:tall_grass',
  'minecraft:fern',
  'minecraft:large_fern',
  'minecraft:deadbush',
  'minecraft:snow_layer',
  'minecraft:vine',
  'minecraft:fire',
  'minecraft:soul_fire',
  'minecraft:water',
  'minecraft:flowing_water',
  'minecraft:lava',
  'minecraft:flowing_lava'
]);

function interactionTarget(
  location: { x: number; y: number; z: number },
  blockType: string,
  face: Direction
) {
  const target = { ...location };
  if (REPLACEABLE_BLOCKS.has(blockType)) return target;
  if (face === Direction.Up) target.y += 1;
  else if (face === Direction.Down) target.y -= 1;
  else if (face === Direction.North) target.z -= 1;
  else if (face === Direction.South) target.z += 1;
  else if (face === Direction.East) target.x += 1;
  else if (face === Direction.West) target.x -= 1;
  return target;
}

function isBlockItem(typeId: string): boolean {
  try {
    return Boolean(BlockTypes.get(typeId));
  } catch {
    return false;
  }
}

function canDamageEnvironment(typeId: string): boolean {
  return (
    typeId === 'minecraft:flint_and_steel' ||
    typeId === 'minecraft:fire_charge' ||
    (typeId.endsWith('_bucket') && typeId !== 'minecraft:bucket' && typeId !== 'minecraft:milk_bucket')
  );
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

export function removeStructureProtections(
  dimension: string,
  bounds: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }
): void {
  const regions = readRegions().filter(
    (region) =>
      region.dimension !== dimension ||
      region.maxX < bounds.minX ||
      region.minX > bounds.maxX ||
      region.maxY < bounds.minY ||
      region.minY > bounds.maxY ||
      region.maxZ < bounds.minZ ||
      region.minZ > bounds.maxZ
  );
  world.setDynamicProperty(PROPERTY, JSON.stringify(regions));
}

world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
  if (event.cancel || !event.itemStack) return;
  const target = interactionTarget(event.block.location, event.block.typeId, event.blockFace);
  const dimension = event.block.dimension.id;
  if (
    (isBlockItem(event.itemStack.typeId) && hasProtection(dimension, target, 'place')) ||
    (canDamageEnvironment(event.itemStack.typeId) &&
      hasProtection(dimension, target, 'environment'))
  ) {
    event.cancel = true;
  }
});

world.beforeEvents.playerBreakBlock.subscribe((event) => {
  if (isStructureProtected(event.dimension.id, event.block.location)) event.cancel = true;
});

world.beforeEvents.explosion.subscribe((event) => {
  event.setImpactedBlocks(
    event.getImpactedBlocks().filter(
      (block) => !hasProtection(event.dimension.id, block.location, 'environment')
    )
  );
});
