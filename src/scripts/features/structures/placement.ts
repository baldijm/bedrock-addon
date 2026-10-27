import {
  ScriptEventSource,
  StructureAnimationMode,
  StructureMirrorAxis,
  StructureRotation,
  system,
  world
} from '@minecraft/server';

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
    mode: input.mode as PlacementRequest['mode']
  };
  if (parsed.minX > parsed.maxX || parsed.minZ > parsed.maxZ) {
    throw new Error('la huella de la estructura no es válida');
  }
  if (parsed.width < 1 || parsed.width > 2048 || parsed.height < 1 || parsed.height > 2048 || parsed.depth < 1 || parsed.depth > 2048) {
    throw new Error('las dimensiones de la estructura no son válidas');
  }
  return parsed;
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

async function placeAfterLoading(message: string): Promise<void> {
  let requestId = 'unknown';
  let areaId: string | undefined;
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
      throw new Error(
        `no hay capacidad para cargar toda la huella (${request.minX},${request.minZ})-(${request.maxX},${request.maxZ})`
      );
    }

    await world.tickingAreaManager.createTickingArea(areaId, options);
    const placement = PLACEMENT_MODES[request.mode];
    const before = new Map(snapshot(dimension, request));
    world.structureManager.place(
      request.structure,
      dimension,
      { x: request.x, y: request.y, z: request.z },
      {
        animationMode: placement.animationMode,
        ...(placement.animationSeconds > 0
          ? { animationSeconds: placement.animationSeconds }
          : {}),
        includeBlocks: true,
        includeEntities: true,
        integrity: 1,
        mirror: MIRRORS[request.mirror],
        rotation: ROTATIONS[request.rotation]
      }
    );
    // An instant placement still needs a tick window for Bedrock's native
    // queue. Keep the temporary area alive while checking the world changed.
    await system.waitTicks(Math.max(40, placement.animationSeconds * 20 + 2));
    const changed = snapshot(dimension, request).some(([key, state]) => before.get(key) !== state);
    if (!changed) {
      marker(
        request.request,
        'UNCONFIRMED',
        'Bedrock aceptó la solicitud, pero no se observó ningún bloque cambiado.'
      );
      return;
    }
    marker(request.request, 'OK');
  } catch (error: unknown) {
    marker(requestId, 'ERROR', error instanceof Error ? error.message : String(error));
  } finally {
    if (areaId && world.tickingAreaManager.hasTickingArea(areaId)) {
      try {
        world.tickingAreaManager.removeTickingArea(areaId);
      } catch (error: unknown) {
        console.warn(`SPB_STRUCTURE_PLACE_CLEANUP ${areaId} ${String(error)}`);
      }
    }
  }
}

system.afterEvents.scriptEventReceive.subscribe(
  (event) => {
    if (event.id !== 'spb:structure_place') return;
    if (event.sourceType !== ScriptEventSource.Server) {
      console.warn('SPB_STRUCTURE_PLACE_REJECTED source must be the dedicated server console');
      return;
    }
    void placeAfterLoading(event.message);
  },
  { namespaces: ['spb'] }
);
