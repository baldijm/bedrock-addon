// Shared by the dashboard and behavior pack. No Minecraft runtime imports.
export type Point = { x: number; y: number; z: number };
export type Region = { min: Point; max: Point };
export type Arena = {
  id: string; name: string; dimension: string;
  p1: Point; p2: Point; returnPoint: Point;
  npc1: Point; npc2: Point; yaw1: number; yaw2: number;
  bounds: Region; goal1: Region; goal2: Region;
};
export type ArenaState = {
  revision: number; arenas: Arena[]; active: Arena | null;
  history: { at: string; action: string; arena: string; actor: string }[];
};
export const legacyArena: Arena = {
  id: 'principal', name: 'Arena principal', dimension: 'minecraft:overworld',
  p1: { x: -500, y: 204, z: 124 }, p2: { x: -500, y: 204, z: 177 },
  returnPoint: { x: -500, y: 204, z: 150 },
  npc1: { x: -504, y: 204, z: 127 }, npc2: { x: -496, y: 204, z: 174 },
  yaw1: 180, yaw2: 0,
  bounds: { min: { x: -515, y: 199, z: 104 }, max: { x: -485, y: 319, z: 197 } },
  goal1: { min: { x: -501, y: 201, z: 120 }, max: { x: -499, y: 203, z: 122 } },
  goal2: { min: { x: -501, y: 201, z: 179 }, max: { x: -499, y: 203, z: 182 } },
};
export function inside(point: Point, region: Region) {
  return (['x', 'y', 'z'] as const).every(axis => point[axis] >= region.min[axis] && point[axis] <= region.max[axis]);
}
export function validateArena(input: unknown): Arena {
  if (!input || typeof input !== 'object') throw new Error('La arena no es válida.');
  const value = input as Record<string, unknown>;
  if (typeof value.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(value.id))
    throw new Error('El identificador admite hasta 32 letras minúsculas, números, guiones y guiones bajos.');
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 60 || /[\u0000-\u001f§]/.test(value.name))
    throw new Error('El nombre debe tener entre 1 y 60 caracteres, sin códigos de formato.');
  const heights: Record<string, [number, number]> = {
    'minecraft:overworld': [-64, 319], 'minecraft:nether': [0, 127], 'minecraft:the_end': [0, 255],
  };
  if (typeof value.dimension !== 'string' || !Object.prototype.hasOwnProperty.call(heights, value.dimension)) throw new Error('Dimensión inválida.');
  const [minY, maxY] = heights[value.dimension];
  function point(raw: unknown, label: string): Point {
    if (!raw || typeof raw !== 'object') throw new Error(`Falta ${label}.`);
    const item = raw as Point;
    for (const axis of ['x', 'y', 'z'] as const)
      if (!Number.isSafeInteger(item[axis]) || Math.abs(item[axis]) > 29_999_984 ||
          (axis === 'y' && (item.y < minY || item.y > maxY))) throw new Error(`${label}: coordenada ${axis.toUpperCase()} inválida.`);
    return { x: item.x, y: item.y, z: item.z };
  }
  function region(raw: unknown, label: string): Region {
    if (!raw || typeof raw !== 'object') throw new Error(`Falta ${label}.`);
    const item = raw as Region;
    const result = { min: point(item.min, `${label} mínima`), max: point(item.max, `${label} máxima`) };
    if (!inside(result.min, result)) throw new Error(`${label}: los mínimos deben ser menores o iguales a los máximos.`);
    return result;
  }
  const bounds = region(value.bounds, 'Área segura');
  const chunks = (Math.floor(bounds.max.x / 16) - Math.floor(bounds.min.x / 16) + 1) *
    (Math.floor(bounds.max.z / 16) - Math.floor(bounds.min.z / 16) + 1);
  if (chunks > 64 || bounds.max.x - bounds.min.x > 127 || bounds.max.z - bounds.min.z > 127)
    throw new Error('El área segura admite hasta 128 × 128 bloques y 64 chunks.');
  const result: Arena = {
    id: value.id, name: value.name.trim(), dimension: value.dimension,
    p1: point(value.p1, 'Jugador 1'), p2: point(value.p2, 'Jugador 2'),
    returnPoint: point(value.returnPoint, 'Retorno'), npc1: point(value.npc1, 'NPC 1'), npc2: point(value.npc2, 'NPC 2'),
    yaw1: Number(value.yaw1), yaw2: Number(value.yaw2), bounds,
    goal1: region(value.goal1, 'Portería 1'), goal2: region(value.goal2, 'Portería 2'),
  };
  for (const yaw of [value.yaw1, value.yaw2])
    if (typeof yaw !== 'number' || !Number.isFinite(yaw) || yaw < -180 || yaw > 180) throw new Error('La orientación debe estar entre -180° y 180°.');
  for (const [label, position] of Object.entries({ P1: result.p1, P2: result.p2, Retorno: result.returnPoint, NPC1: result.npc1, NPC2: result.npc2 }))
    if (!inside(position, bounds) || position.y < minY + 1 || position.y > maxY - 2 || position.y + 1 > bounds.max.y)
      throw new Error(`${label} debe quedar dentro del área, con espacio para el cuerpo y suelo debajo.`);
  for (const goal of [result.goal1, result.goal2])
    if (!inside(goal.min, bounds) || !inside(goal.max, bounds)) throw new Error('Las porterías deben quedar dentro del área segura.');
  if ((['x', 'y', 'z'] as const).every(axis => result.goal1.min[axis] <= result.goal2.max[axis] && result.goal1.max[axis] >= result.goal2.min[axis]))
    throw new Error('Las porterías no pueden superponerse.');
  const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  if (distance(result.npc1, result.npc2) < 4 || distance(result.p1, result.p2) < 2)
    throw new Error('Separa los NPC al menos 4 bloques y los jugadores al menos 2 bloques.');
  return result;
}
