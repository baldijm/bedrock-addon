import { ScriptEventSource, StructureAnimationMode, StructureMirrorAxis, StructureRotation, StructureSaveMode, system, world } from '@minecraft/server';
import { protectStructurePlacement } from './protection.js';
const ROTATIONS = {
    '0_degrees': StructureRotation.None,
    '90_degrees': StructureRotation.Rotate90,
    '180_degrees': StructureRotation.Rotate180,
    '270_degrees': StructureRotation.Rotate270
};
const MIRRORS = {
    none: StructureMirrorAxis.None,
    x: StructureMirrorAxis.X,
    z: StructureMirrorAxis.Z,
    xz: StructureMirrorAxis.XZ
};
// A layered placement goes from the base upwards. This means a gravity block
// gets its support before Bedrock places that block's own layer.
const PLACEMENT_MODES = {
    instant: { animationMode: StructureAnimationMode.None, animationSeconds: 0 },
    layers: { animationMode: StructureAnimationMode.Layers, animationSeconds: 12 }
};
const IDENTIFIER = /^[a-z0-9][a-z0-9_.-]{0,31}:[a-z0-9][a-z0-9_./-]{0,95}$/;
const REQUEST_ID = /^[a-f0-9]{12}$/;
const WORLD_LIMIT = 29_999_984;
function integer(value, name) {
    if (!Number.isInteger(value) || typeof value !== 'number' || Math.abs(value) > WORLD_LIMIT) {
        throw new Error(`${name} no es válido`);
    }
    return value;
}
function parseRequest(message) {
    let value;
    try {
        value = JSON.parse(message);
    }
    catch {
        throw new Error('el mensaje no contiene JSON válido');
    }
    if (!value || typeof value !== 'object')
        throw new Error('la solicitud no es un objeto');
    const input = value;
    if (typeof input.request !== 'string' || !REQUEST_ID.test(input.request)) {
        throw new Error('el identificador de solicitud no es válido');
    }
    if (typeof input.structure !== 'string' || !IDENTIFIER.test(input.structure)) {
        throw new Error('el identificador de estructura no es válido');
    }
    if (typeof input.rotation !== 'string' || !(input.rotation in ROTATIONS)) {
        throw new Error('la rotación no es válida');
    }
    if (typeof input.mirror !== 'string' || !(input.mirror in MIRRORS)) {
        throw new Error('el espejo no es válido');
    }
    if (typeof input.mode !== 'string' || !(input.mode in PLACEMENT_MODES)) {
        throw new Error('el modo de colocación no es válido');
    }
    const parsed = {
        request: input.request,
        structure: input.structure,
        x: integer(input.x, 'X'),
        y: integer(input.y, 'Y'),
        z: integer(input.z, 'Z'),
        minX: integer(input.minX, 'X mínima'),
        maxX: integer(input.maxX, 'X máxima'),
        minZ: integer(input.minZ, 'Z mínima'),
        maxZ: integer(input.maxZ, 'Z máxima'),
        width: integer(input.width, 'ancho'),
        height: integer(input.height, 'alto'),
        depth: integer(input.depth, 'profundidad'),
        rotation: input.rotation,
        mirror: input.mirror,
        mode: input.mode,
        // Old bridge requests predate these fields. They intentionally keep the
        // native behavior: blocks and air in the template replace the destination.
        includeBlocks: input.includeBlocks !== false,
        // Old bridge requests predate this field. They intentionally keep the
        // native behavior: air in the template replaces the destination.
        includeAir: input.includeAir !== false,
        // Older requests retain their previous behavior: no protection unless the
        // dashboard explicitly requested it.
        protectBlocks: input.protectBlocks === true && input.includeBlocks !== false
    };
    if (parsed.minX > parsed.maxX || parsed.minZ > parsed.maxZ) {
        throw new Error('la huella de la estructura no es válida');
    }
    if (parsed.width < 1 || parsed.width > 2048 || parsed.height < 1 || parsed.height > 2048 || parsed.depth < 1 || parsed.depth > 2048) {
        throw new Error('las dimensiones de la estructura no son válidas');
    }
    return parsed;
}
function marker(request, status, detail = '') {
    const safeDetail = detail.replace(/\s+/g, ' ').slice(0, 300);
    console.warn(`SPB_STRUCTURE_PLACE ${request} ${status}${safeDetail ? ` ${safeDetail}` : ''}`);
}
function transformedLocation(request, localX, localY, localZ) {
    let x = localX;
    let z = localZ;
    if (request.mirror === 'x' || request.mirror === 'xz')
        x = -x;
    if (request.mirror === 'z' || request.mirror === 'xz')
        z = -z;
    if (request.rotation === '90_degrees')
        [x, z] = [-z, x];
    else if (request.rotation === '180_degrees')
        [x, z] = [-x, -z];
    else if (request.rotation === '270_degrees')
        [x, z] = [z, -x];
    return { x: request.x + x, y: request.y + localY, z: request.z + z };
}
function samples(size, maximum) {
    const count = Math.min(size, maximum);
    if (count <= 1)
        return [0];
    const values = Array.from({ length: count }, (_, index) => Math.round((index * (size - 1)) / (count - 1)));
    return [...new Set(values)];
}
function blockState(dimension, location) {
    const block = dimension.getBlock(location);
    if (!block)
        return 'unavailable';
    return `${block.typeId}:${JSON.stringify(block.permutation.getAllStates())}`;
}
function snapshot(dimension, request) {
    const locations = new Map();
    for (const localX of samples(request.width, 10)) {
        for (const localY of samples(request.height, 8)) {
            for (const localZ of samples(request.depth, 10)) {
                const location = transformedLocation(request, localX, localY, localZ);
                locations.set(`${location.x},${location.y},${location.z}`, location);
            }
        }
    }
    return [...locations.entries()].map(([key, location]) => [key, blockState(dimension, location)]);
}
function isAir(permutation) {
    return !permutation || permutation.type.id.endsWith(':air');
}
/**
 * Bedrock does not expose an "include air" placement flag. A missing block in
 * a Structure is its equivalent of a structure void: loading it preserves the
 * block already in the world. Make a memory-only copy and turn air cells into
 * missing cells, so the pack structure and the player's library remain intact.
 */
function makeNoAirVariant(request) {
    const source = world.structureManager.get(request.structure);
    if (!source)
        throw new Error(`no existe la estructura ${request.structure}`);
    const identifier = `spb:placement_no_air_${request.request}`;
    const variant = source.saveAs(identifier, StructureSaveMode.Memory);
    return {
        identifier,
        variant,
        complete: new Promise((resolve, reject) => {
            function* removeAir() {
                try {
                    let inspected = 0;
                    for (let y = 0; y < request.height; y += 1) {
                        for (let z = 0; z < request.depth; z += 1) {
                            for (let x = 0; x < request.width; x += 1) {
                                const location = { x, y, z };
                                if (isAir(variant.getBlockPermutation(location))) {
                                    variant.setBlockPermutation(location, undefined);
                                }
                                // Large templates can contain millions of cells. Yield often
                                // enough to keep the script watchdog and the server responsive.
                                inspected += 1;
                                if (inspected % 256 === 0)
                                    yield;
                            }
                        }
                    }
                    resolve();
                }
                catch (error) {
                    reject(error);
                }
            }
            system.runJob(removeAir());
        })
    };
}
/**
 * The Script API grants each pack a smaller private ticking-area budget than
 * the command system. Large remote builds can exceed that budget even though
 * their footprint is valid. Split their footprint into command ticking areas
 * of at most 10x10 chunks (the Bedrock command limit is 100 chunks per area).
 */
function commandAreaSegments(request) {
    const minChunkX = Math.floor(request.minX / 16);
    const maxChunkX = Math.floor(request.maxX / 16);
    const minChunkZ = Math.floor(request.minZ / 16);
    const maxChunkZ = Math.floor(request.maxZ / 16);
    const segments = [];
    for (let chunkZ = minChunkZ; chunkZ <= maxChunkZ; chunkZ += 10) {
        for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX += 10) {
            const endChunkX = Math.min(maxChunkX, chunkX + 9);
            const endChunkZ = Math.min(maxChunkZ, chunkZ + 9);
            segments.push({
                from: { x: Math.max(request.minX, chunkX * 16), z: Math.max(request.minZ, chunkZ * 16) },
                to: { x: Math.min(request.maxX, endChunkX * 16 + 15), z: Math.min(request.maxZ, endChunkZ * 16 + 15) }
            });
        }
    }
    return segments;
}
function areaIsLoaded(dimension, request, segment) {
    try {
        return Boolean(dimension.getBlock({ x: segment.from.x, y: request.y, z: segment.from.z })) &&
            Boolean(dimension.getBlock({ x: segment.to.x, y: request.y, z: segment.to.z }));
    }
    catch {
        return false;
    }
}
async function createPlacementAreas(dimension, request, managerAreaId) {
    const options = {
        dimension,
        from: { x: request.minX, y: 0, z: request.minZ },
        to: { x: request.maxX, y: 0, z: request.maxZ }
    };
    if (world.tickingAreaManager.hasCapacity(options)) {
        await world.tickingAreaManager.createTickingArea(managerAreaId, options);
        return { managerAreaId, commandAreaIds: [] };
    }
    const segments = commandAreaSegments(request);
    if (segments.length > 10) {
        throw new Error(`la estructura requiere ${segments.length} áreas temporales; Bedrock permite como máximo 10`);
    }
    const commandAreaIds = [];
    try {
        for (const [index, segment] of segments.entries()) {
            const id = `spbpl${request.request}${index}`;
            dimension.runCommand(`tickingarea add ${segment.from.x} 0 ${segment.from.z} ${segment.to.x} 0 ${segment.to.z} ${id} true`);
            commandAreaIds.push(id);
            // Preloading a large area can do substantial synchronous work. Yield
            // between areas so four remote loads cannot trip Bedrock's watchdog.
            await system.waitTicks(1);
        }
        // Command ticking areas load asynchronously. Confirm each edge is
        // available before asking StructureManager to place the full template.
        // A freshly generated remote footprint can take far longer than a
        // nearby chunk. Give Bedrock one minute before declaring a real load
        // failure; the bridge itself waits longer than this operation.
        for (let attempt = 0; attempt < 120; attempt += 1) {
            if (segments.every((segment) => areaIsLoaded(dimension, request, segment))) {
                return { managerAreaId: undefined, commandAreaIds };
            }
            await system.waitTicks(10);
        }
        throw new Error('Bedrock no terminó de cargar las áreas temporales a tiempo');
    }
    catch (error) {
        for (const id of commandAreaIds) {
            try {
                dimension.runCommand(`tickingarea remove ${id}`);
            }
            catch {
                // Keep the actual setup error; cleanup is best effort.
            }
        }
        throw error;
    }
}
async function placeAfterLoading(message) {
    let requestId = 'unknown';
    let areaId;
    let commandAreaIds = [];
    let transientStructure;
    try {
        const request = parseRequest(message);
        requestId = request.request;
        areaId = `spb_place_${request.request}`;
        const dimension = world.getDimension('overworld');
        const placementAreas = await createPlacementAreas(dimension, request, areaId);
        areaId = placementAreas.managerAreaId;
        commandAreaIds = placementAreas.commandAreaIds;
        const placement = PLACEMENT_MODES[request.mode];
        const before = request.includeBlocks ? new Map(snapshot(dimension, request)) : undefined;
        let structure = request.structure;
        if (request.includeBlocks && !request.includeAir) {
            const noAir = makeNoAirVariant(request);
            transientStructure = noAir.identifier;
            await noAir.complete;
            structure = noAir.variant.id;
        }
        world.structureManager.place(structure, dimension, { x: request.x, y: request.y, z: request.z }, {
            animationMode: placement.animationMode,
            ...(placement.animationSeconds > 0
                ? { animationSeconds: placement.animationSeconds }
                : {}),
            includeBlocks: request.includeBlocks,
            includeEntities: true,
            integrity: 1,
            mirror: MIRRORS[request.mirror],
            rotation: ROTATIONS[request.rotation]
        });
        if (request.protectBlocks) {
            protectStructurePlacement({
                id: request.request,
                dimension: dimension.id,
                minX: request.minX,
                maxX: request.maxX,
                minY: request.y,
                maxY: request.y + request.height - 1,
                minZ: request.minZ,
                maxZ: request.maxZ
            });
        }
        // An instant placement still needs a tick window for Bedrock's native
        // queue. Keep the temporary area alive while checking the world changed.
        await system.waitTicks(Math.max(40, placement.animationSeconds * 20 + 2));
        // Entity-only loads deliberately leave the world blocks unchanged, so a
        // block snapshot cannot be used as their completion signal.
        const changed = !before || snapshot(dimension, request).some(([key, state]) => before.get(key) !== state);
        if (!changed) {
            marker(request.request, 'UNCONFIRMED', 'Bedrock aceptó la solicitud, pero no se observó ningún bloque cambiado.');
            return;
        }
        marker(request.request, 'OK');
    }
    catch (error) {
        marker(requestId, 'ERROR', error instanceof Error ? error.message : String(error));
    }
    finally {
        if (transientStructure) {
            try {
                world.structureManager.delete(transientStructure);
            }
            catch (error) {
                console.warn(`SPB_STRUCTURE_PLACE_CLEANUP ${transientStructure} ${String(error)}`);
            }
        }
        if (areaId && world.tickingAreaManager.hasTickingArea(areaId)) {
            try {
                world.tickingAreaManager.removeTickingArea(areaId);
            }
            catch (error) {
                console.warn(`SPB_STRUCTURE_PLACE_CLEANUP ${areaId} ${String(error)}`);
            }
        }
        for (const id of commandAreaIds) {
            try {
                world.getDimension('overworld').runCommand(`tickingarea remove ${id}`);
            }
            catch (error) {
                console.warn(`SPB_STRUCTURE_PLACE_CLEANUP ${id} ${String(error)}`);
            }
        }
    }
}
system.afterEvents.scriptEventReceive.subscribe((event) => {
    if (event.id !== 'spb:structure_place')
        return;
    if (event.sourceType !== ScriptEventSource.Server) {
        console.warn('SPB_STRUCTURE_PLACE_REJECTED source must be the dedicated server console');
        return;
    }
    void placeAfterLoading(event.message);
}, { namespaces: ['spb'] });
//# sourceMappingURL=placement.js.map
