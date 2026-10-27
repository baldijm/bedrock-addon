import { ScriptEventSource, StructureAnimationMode, StructureMirrorAxis, StructureRotation, system, world } from '@minecraft/server';
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
        rotation: input.rotation,
        mirror: input.mirror
    };
    if (parsed.minX > parsed.maxX || parsed.minZ > parsed.maxZ) {
        throw new Error('la huella de la estructura no es válida');
    }
    return parsed;
}
function marker(request, status, detail = '') {
    const safeDetail = detail.replace(/\s+/g, ' ').slice(0, 300);
    console.warn(`SPB_STRUCTURE_PLACE ${request} ${status}${safeDetail ? ` ${safeDetail}` : ''}`);
}
async function placeAfterLoading(message) {
    let requestId = 'unknown';
    let areaId;
    try {
        const request = parseRequest(message);
        requestId = request.request;
        areaId = `spb_place_${request.request}`;
        const dimension = world.getDimension('overworld');
        const options = {
            dimension,
            from: { x: request.minX, y: 0, z: request.minZ },
            to: { x: request.maxX, y: 0, z: request.maxZ }
        };
        if (!world.tickingAreaManager.hasCapacity(options)) {
            throw new Error(`no hay capacidad para cargar toda la huella (${request.minX},${request.minZ})-(${request.maxX},${request.maxZ})`);
        }
        await world.tickingAreaManager.createTickingArea(areaId, options);
        world.structureManager.place(request.structure, dimension, { x: request.x, y: request.y, z: request.z }, {
            animationMode: StructureAnimationMode.None,
            includeBlocks: true,
            includeEntities: true,
            integrity: 1,
            mirror: MIRRORS[request.mirror],
            rotation: ROTATIONS[request.rotation]
        });
        marker(request.request, 'OK');
    }
    catch (error) {
        marker(requestId, 'ERROR', error instanceof Error ? error.message : String(error));
    }
    finally {
        if (areaId && world.tickingAreaManager.hasTickingArea(areaId)) {
            try {
                world.tickingAreaManager.removeTickingArea(areaId);
            }
            catch (error) {
                console.warn(`SPB_STRUCTURE_PLACE_CLEANUP ${areaId} ${String(error)}`);
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