import { world } from '@minecraft/server';
const PROPERTY = 'spb:structure_protections';
const MAX_REGIONS = 100;
function readRegions() {
    const value = world.getDynamicProperty(PROPERTY);
    if (typeof value !== 'string')
        return [];
    try {
        const parsed = JSON.parse(value);
        if (!Array.isArray(parsed))
            return [];
        return parsed.filter(isRegion).slice(-MAX_REGIONS);
    }
    catch {
        return [];
    }
}
function isRegion(value) {
    if (!value || typeof value !== 'object')
        return false;
    const region = value;
    return (typeof region.id === 'string' &&
        typeof region.dimension === 'string' &&
        ['minX', 'maxX', 'minY', 'maxY', 'minZ', 'maxZ'].every((key) => typeof region[key] === 'number' && Number.isInteger(region[key])));
}
function contains(region, dimension, location) {
    return (region.dimension === dimension &&
        location.x >= region.minX &&
        location.x <= region.maxX &&
        location.y >= region.minY &&
        location.y <= region.maxY &&
        location.z >= region.minZ &&
        location.z <= region.maxZ);
}
export function isStructureProtected(dimension, location) {
    return readRegions().some((region) => contains(region, dimension, location));
}
/**
 * A placement protection is intentionally a cuboid: it remains reliable after
 * rotation/mirroring and survives restarts without storing every individual
 * block of a potentially huge structure.
 */
export function protectStructurePlacement(region) {
    const regions = readRegions().filter((current) => current.id !== region.id);
    regions.push(region);
    world.setDynamicProperty(PROPERTY, JSON.stringify(regions.slice(-MAX_REGIONS)));
}
world.beforeEvents.playerBreakBlock.subscribe((event) => {
    if (isStructureProtected(event.dimension.id, event.block.location))
        event.cancel = true;
});
world.beforeEvents.explosion.subscribe((event) => {
    event.setImpactedBlocks(event.getImpactedBlocks().filter((block) => !isStructureProtected(event.dimension.id, block.location)));
});
//# sourceMappingURL=protection.js.map