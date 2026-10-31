import {
  BlockVolume,
  ScriptEventSource,
  StructureAnimationMode,
  StructureMirrorAxis,
  StructureRotation,
  StructureSaveMode,
  system,
  world
} from '@minecraft/server';
import type { BlockPermutation, Dimension } from '@minecraft/server';
import { protectStructurePlacement, removeStructureProtections } from './protection.js';

type AreaRequest = {
  request: string;
  y: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

type PlacementRequest = {
  request: string;
  structure: string;
  x: number;
  y: number;
  z: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  width: number;
  height: number;
  depth: number;
  rotation: keyof typeof ROTATIONS;
  mirror: keyof typeof MIRRORS;
  mode: keyof typeof PLACEMENT_MODES;
  includeBlocks: boolean;
  includeAir: boolean;
  protectBlocks: boolean;
  protectPlace: boolean;
  protectEnvironment: boolean;
};

type EraseRequest = AreaRequest & {
  x: number;
  z: number;
  width: number;
  height: number;
  depth: number;
};

const ROTATIONS = {
  '0_degrees': StructureRotation.None,
  '90_degrees': StructureRotation.Rotate90,
  '180_degrees': StructureRotation.Rotate180,
  '270_degrees': StructureRotation.Rotate270
} as const;

const MIRRORS = {
  none: StructureMirrorAxis.None,
  x: StructureMirrorAxis.X,
  z: StructureMirrorAxis.Z,
  xz: StructureMirrorAxis.XZ
} as const;

// A layered placement goes from the base upwards. This means a gravity block
// gets its support before Bedrock places that block's own layer.
const PLACEMENT_MODES = {
  instant: { animationMode: StructureAnimationMode.None, animationSeconds: 0 },
  layers: { animationMode: StructureAnimationMode.Layers, animationSeconds: 12 }
} as const;

const IDENTIFIER = /^[a-z0-9][a-z0-9_.-]{0,31}:[a-z0-9][a-z0-9_./-]{0,95}$/;
const REQUEST_ID = /^[a-f0-9]{12}$/;
const WORLD_LIMIT = 29_999_984;

function integer(value: unknown, name: string): number {
  if (!Number.isInteger(value) || typeof value !== 'number' || Math.abs(value) > WORLD_LIMIT) {
    throw new Error(`${name} no es válido`);
  }
  return value;
}

function parseRequest(message: string): PlacementRequest {
  let value: unknown;
  try {
    value = JSON.parse(message);
  } catch {
    throw new Error('el mensaje no contiene JSON válido');
  }
  if (!value || typeof value !== 'object') throw new Error('la solicitud no es un objeto');
  const input = value as Record<string, unknown>;
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

  const parsed: PlacementRequest = {
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
    rotation: input.rotation as PlacementRequest['rotation'],
    mirror: input.mirror as PlacementRequest['mirror'],
    mode: input.mode as PlacementRequest['mode'],
    // Old bridge requests predate these fields. They intentionally keep the
    // native behavior: blocks and air in the template replace the destination.
    includeBlocks: input.includeBlocks !== false,
    // Old bridge requests predate this field. They intentionally keep the
    // native behavior: air in the template replaces the destination.
    includeAir: input.includeAir !== false,
    // Older requests retain their previous behavior: no protection unless the
    // dashboard explicitly requested it.
    protectBlocks: input.protectBlocks === true && input.includeBlocks !== false,
    protectPlace: input.protectPlace === true && input.includeBlocks !== false,
    protectEnvironment: input.protectEnvironment === true && input.includeBlocks !== false
  };
  if (parsed.minX > parsed.maxX || parsed.minZ > parsed.maxZ) {
    throw new Error('la huella de la estructura no es válida');
  }
  if (parsed.width < 1 || parsed.width > 2048 || parsed.height < 1 || parsed.height > 2048 || parsed.depth < 1 || parsed.depth > 2048) {
    throw new Error('las dimensiones de la estructura no son válidas');
  }
  return parsed;
}

function parseEraseRequest(message: string): EraseRequest {
  let value: unknown;
  try {
    value = JSON.parse(message);
  } catch {
    throw new Error('el mensaje de borrado no contiene JSON válido');
  }
  if (!value || typeof value !== 'object') throw new Error('la solicitud de borrado no es un objeto');
  const input = value as Record<string, unknown>;
  if (typeof input.request !== 'string' || !REQUEST_ID.test(input.request)) {
    throw new Error('el identificador de solicitud no es válido');
  }
  const request: EraseRequest = {
    request: input.request,
    x: integer(input.x, 'X'),
    y: integer(input.y, 'Y'),
    z: integer(input.z, 'Z'),
    minX: integer(input.minX, 'X mínima'),
    maxX: integer(input.maxX, 'X máxima'),
    minZ: integer(input.minZ, 'Z mínima'),
    maxZ: integer(input.maxZ, 'Z máxima'),
    width: integer(input.width, 'ancho'),
    height: integer(input.height, 'alto'),
    depth: integer(input.depth, 'profundidad')
  };
  if (
    request.width < 1 || request.width > 512 ||
    request.height < 1 || request.height > 512 ||
    request.depth < 1 || request.depth > 512 ||
    request.width * request.height * request.depth > 8_000_000 ||
    request.minX !== request.x || request.minZ !== request.z ||
    request.maxX !== request.x + request.width - 1 ||
    request.maxZ !== request.z + request.depth - 1
  ) {
    throw new Error('el volumen de borrado no es válido o supera 8,000,000 de bloques');
  }
  return request;
}

function marker(request: string, status: 'OK' | 'UNCONFIRMED' | 'ERROR', detail = ''): void {
  const safeDetail = detail.replace(/\s+/g, ' ').slice(0, 300);
  console.warn(`SPB_STRUCTURE_PLACE ${request} ${status}${safeDetail ? ` ${safeDetail}` : ''}`);
}

function transformedLocation(request: PlacementRequest, localX: number, localY: number, localZ: number) {
  let x = localX;
  let z = localZ;
  if (request.mirror === 'x' || request.mirror === 'xz') x = -x;
  if (request.mirror === 'z' || request.mirror === 'xz') z = -z;
  if (request.rotation === '90_degrees') [x, z] = [-z, x];
  else if (request.rotation === '180_degrees') [x, z] = [-x, -z];
  else if (request.rotation === '270_degrees') [x, z] = [z, -x];
  return { x: request.x + x, y: request.y + localY, z: request.z + z };
}

function samples(size: number, maximum: number): number[] {
  const count = Math.min(size, maximum);
  if (count <= 1) return [0];
  const values = Array.from({ length: count }, (_, index) =>
    Math.round((index * (size - 1)) / (count - 1))
  );
  return [...new Set(values)];
}

function blockState(dimension: ReturnType<typeof world.getDimension>, location: { x: number; y: number; z: number }) {
  const block = dimension.getBlock(location);
  if (!block) return 'unavailable';
  return `${block.typeId}:${JSON.stringify(block.permutation.getAllStates())}`;
}

function snapshot(dimension: ReturnType<typeof world.getDimension>, request: PlacementRequest) {
  const locations = new Map<string, { x: number; y: number; z: number }>();
  for (const localX of samples(request.width, 10)) {
    for (const localY of samples(request.height, 8)) {
      for (const localZ of samples(request.depth, 10)) {
        const location = transformedLocation(request, localX, localY, localZ);
        locations.set(`${location.x},${location.y},${location.z}`, location);
      }
    }
  }
  return [...locations.entries()].map(([key, location]) => [key, blockState(dimension, location)] as const);
}

function isAir(permutation: BlockPermutation | undefined) {
  return !permutation || permutation.type.id.endsWith(':air');
}

/**
 * Bedrock does not expose an "include air" placement flag. A missing block in
 * a Structure is its equivalent of a structure void: loading it preserves the
 * block already in the world. Make a memory-only copy and turn air cells into
 * missing cells, so the pack structure and the player's library remain intact.
 */
function makeNoAirVariant(request: PlacementRequest) {
  const source = world.structureManager.get(request.structure);
  if (!source) throw new Error(`no existe la estructura ${request.structure}`);
  const identifier = `spb:placement_no_air_${request.request}`;
  const variant = source.saveAs(identifier, StructureSaveMode.Memory);

  return {
    identifier,
    variant,
    complete: new Promise<void>((resolve, reject) => {
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
                if (inspected % 256 === 0) yield;
              }
            }
          }
          resolve();
        } catch (error: unknown) {
          reject(error);
        }
      }
      system.runJob(removeAir());
    })
  };
}


type CommandAreaSegment = {
  from: { x: number; z: number };
  to: { x: number; z: number };
};

const MAX_COMMAND_TICKING_AREAS = 10;
const MAX_CHUNKS_PER_COMMAND_AREA = 100;

function commandAreaSegments(request: AreaRequest): CommandAreaSegment[] {
  const minChunkX = Math.floor(request.minX / 16);
  const maxChunkX = Math.floor(request.maxX / 16);
  const minChunkZ = Math.floor(request.minZ / 16);
  const maxChunkZ = Math.floor(request.maxZ / 16);
  const chunkWidth = maxChunkX - minChunkX + 1;
  const chunkDepth = maxChunkZ - minChunkZ + 1;

  // The command API permits up to ten ticking areas of one hundred chunks each.
  // Pick the tiling that uses the fewest areas instead of the former fixed 4x10
  // tiles, which unnecessarily rejected wide-but-valid structures.
  let chunkSpanX = 1;
  let chunkSpanZ = 1;
  let minimumAreaCount = Number.POSITIVE_INFINITY;
  for (let candidateZ = 1; candidateZ <= Math.min(chunkDepth, MAX_CHUNKS_PER_COMMAND_AREA); candidateZ += 1) {
    const candidateX = Math.min(
      chunkWidth,
      Math.floor(MAX_CHUNKS_PER_COMMAND_AREA / candidateZ)
    );
    const areaCount = Math.ceil(chunkWidth / candidateX) * Math.ceil(chunkDepth / candidateZ);
    if (areaCount < minimumAreaCount) {
      minimumAreaCount = areaCount;
      chunkSpanX = candidateX;
      chunkSpanZ = candidateZ;
    }
  }

  if (minimumAreaCount > MAX_COMMAND_TICKING_AREAS) {
    throw new Error(
      `la huella abarca ${chunkWidth * chunkDepth} chunks y no cabe en las ` +
      `${MAX_COMMAND_TICKING_AREAS} áreas temporales de ${MAX_CHUNKS_PER_COMMAND_AREA} chunks de Bedrock`
    );
  }

  const segments: CommandAreaSegment[] = [];

  for (let chunkZ = minChunkZ; chunkZ <= maxChunkZ; chunkZ += chunkSpanZ) {
    for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX += chunkSpanX) {
      const endChunkX = Math.min(maxChunkX, chunkX + chunkSpanX - 1);
      const endChunkZ = Math.min(maxChunkZ, chunkZ + chunkSpanZ - 1);
      segments.push({
        from: {
          x: Math.max(request.minX, chunkX * 16),
          z: Math.max(request.minZ, chunkZ * 16)
        },
        to: {
          x: Math.min(request.maxX, endChunkX * 16 + 15),
          z: Math.min(request.maxZ, endChunkZ * 16 + 15)
        }
      });
    }
  }
  return segments;
}

function areaIsLoaded(
  dimension: Dimension,
  request: AreaRequest,
  segment: CommandAreaSegment
): boolean {
  try {
    return Boolean(dimension.getBlock({
      x: segment.from.x, y: request.y, z: segment.from.z
    })) && Boolean(dimension.getBlock({
      x: segment.to.x, y: request.y, z: segment.to.z
    }));
  } catch {
    return false;
  }
}

async function createPlacementAreas(
  dimension: Dimension,
  request: AreaRequest,
  managerAreaId: string
): Promise<{ managerAreaId?: string; commandAreaIds: string[] }> {
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

  const commandAreaIds: string[] = [];
  try {
    for (const [index, segment] of segments.entries()) {
      const id = `spbpl${request.request}${index}`;
      dimension.runCommand(
        `tickingarea add ${segment.from.x} 0 ${segment.from.z} ` +
        `${segment.to.x} 0 ${segment.to.z} ${id} true`
      );
      commandAreaIds.push(id);
      await system.waitTicks(1);
    }

    for (let attempt = 0; attempt < 120; attempt += 1) {
      if (segments.every(segment => areaIsLoaded(dimension, request, segment))) {
        return { managerAreaId: undefined, commandAreaIds };
      }
      await system.waitTicks(10);
    }
    throw new Error('Bedrock no terminó de cargar las áreas temporales a tiempo');
  } catch (error) {
    for (const id of commandAreaIds) {
      try {
        dimension.runCommand(`tickingarea remove ${id}`);
      } catch {
        // Conservar el error original.
      }
    }
    throw error;
  }
}

async function eraseAfterLoading(message: string): Promise<void> {
  let requestId = 'unknown';
  let areaId: string | undefined;
  let commandAreaIds: string[] = [];
  try {
    const request = parseEraseRequest(message);
    requestId = request.request;
    areaId = `spb_erase_${request.request}`;
    const dimension = world.getDimension('overworld');
    const placementAreas = await createPlacementAreas(dimension, request, areaId);
    areaId = placementAreas.managerAreaId;
    commandAreaIds = placementAreas.commandAreaIds;

    for (let y = request.y; y < request.y + request.height; y += 16) {
      for (let z = request.z; z < request.z + request.depth; z += 16) {
        for (let x = request.x; x < request.x + request.width; x += 16) {
          dimension.fillBlocks(
            new BlockVolume(
              { x, y, z },
              {
                x: Math.min(request.x + request.width - 1, x + 15),
                y: Math.min(request.y + request.height - 1, y + 15),
                z: Math.min(request.z + request.depth - 1, z + 15)
              }
            ),
            'minecraft:air'
          );
          await system.waitTicks(1);
        }
      }
    }

    removeStructureProtections(dimension.id, {
      minX: request.x,
      maxX: request.x + request.width - 1,
      minY: request.y,
      maxY: request.y + request.height - 1,
      minZ: request.z,
      maxZ: request.z + request.depth - 1
    });
    console.warn(`SPB_STRUCTURE_ERASE ${request.request} OK`);
  } catch (error: unknown) {
    const detail = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').slice(0, 300);
    console.warn(`SPB_STRUCTURE_ERASE ${requestId} ERROR ${detail}`);
  } finally {
    if (areaId && world.tickingAreaManager.hasTickingArea(areaId)) {
      try {
        world.tickingAreaManager.removeTickingArea(areaId);
      } catch (error: unknown) {
        console.warn(`SPB_STRUCTURE_ERASE_CLEANUP ${areaId} ${String(error)}`);
      }
    }
    for (const id of commandAreaIds) {
      try {
        world.getDimension('overworld').runCommand(`tickingarea remove ${id}`);
      } catch (error: unknown) {
        console.warn(`SPB_STRUCTURE_ERASE_CLEANUP ${id} ${String(error)}`);
      }
    }
  }
}

async function placeAfterLoading(message: string): Promise<void> {
  let requestId = 'unknown';
  let areaId: string | undefined;
  let commandAreaIds: string[] = [];
  let transientStructure: string | undefined;
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
    let structure: string = request.structure;
    if (request.includeBlocks && !request.includeAir) {
      const noAir = makeNoAirVariant(request);
      transientStructure = noAir.identifier;
      await noAir.complete;
      structure = noAir.variant.id;
    }
    world.structureManager.place(
      structure,
      dimension,
      { x: request.x, y: request.y, z: request.z },
      {
        animationMode: placement.animationMode,
        ...(placement.animationSeconds > 0
          ? { animationSeconds: placement.animationSeconds }
          : {}),
        includeBlocks: request.includeBlocks,
        includeEntities: true,
        integrity: 1,
        mirror: MIRRORS[request.mirror],
        rotation: ROTATIONS[request.rotation]
      }
    );
    // An instant placement still needs a tick window for Bedrock's native
    // queue. Keep the temporary area alive while checking the world changed.
    await system.waitTicks(Math.max(40, placement.animationSeconds * 20 + 2));
    // Entity-only loads deliberately leave the world blocks unchanged, so a
    // block snapshot cannot be used as their completion signal.
    const changed = !before || snapshot(dimension, request).some(([key, state]) => before.get(key) !== state);
    if (!changed) {
      marker(
        request.request,
        'UNCONFIRMED',
        'Bedrock aceptó la solicitud, pero no se observó ningún bloque cambiado.'
      );
      return;
    }
    if (request.protectBlocks || request.protectPlace || request.protectEnvironment) {
      protectStructurePlacement({
        id: request.request,
        dimension: dimension.id,
        minX: request.minX,
        maxX: request.maxX,
        minY: request.y,
        maxY: request.y + request.height - 1,
        minZ: request.minZ,
        maxZ: request.maxZ,
        protectBreak: request.protectBlocks,
        protectPlace: request.protectPlace,
        protectEnvironment: request.protectEnvironment
      });
    }
    marker(request.request, 'OK');
  } catch (error: unknown) {
    marker(requestId, 'ERROR', error instanceof Error ? error.message : String(error));
  } finally {
    if (transientStructure) {
      try {
        world.structureManager.delete(transientStructure);
      } catch (error: unknown) {
        console.warn(`SPB_STRUCTURE_PLACE_CLEANUP ${transientStructure} ${String(error)}`);
      }
    }
    if (areaId && world.tickingAreaManager.hasTickingArea(areaId)) {
      try {
        world.tickingAreaManager.removeTickingArea(areaId);
      } catch (error: unknown) {
        console.warn(`SPB_STRUCTURE_PLACE_CLEANUP ${areaId} ${String(error)}`);
      }
    }
    for (const id of commandAreaIds) {
      try {
        world.getDimension('overworld').runCommand(`tickingarea remove ${id}`);
      } catch (error: unknown) {
        console.warn(`SPB_STRUCTURE_PLACE_CLEANUP ${id} ${String(error)}`);
      }
    }
  }
}

system.afterEvents.scriptEventReceive.subscribe(
  (event) => {
    if (event.id !== 'spb:structure_place' && event.id !== 'spb:structure_erase') return;
    if (event.sourceType !== ScriptEventSource.Server) {
      console.warn('SPB_STRUCTURE_PLACE_REJECTED source must be the dedicated server console');
      return;
    }
    if (event.id === 'spb:structure_erase') void eraseAfterLoading(event.message);
    else void placeAfterLoading(event.message);
  },
  { namespaces: ['spb'] }
);
