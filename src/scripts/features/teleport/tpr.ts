import { InputPermissionCategory, system, type Dimension, type Player, world } from '@minecraft/server';

const DISTANCIA_MINIMA = 300;
const DISTANCIA_MAXIMA = 2500;
const MAX_INTENTOS = 6;
const MAX_ESPERA_TICKS = 100;
const CUENTA_REGRESIVA_SEGUNDOS = 5;
const MUESTRAS_POR_ZONA = 24;
const RADIO_BUSQUEDA_CARGADA = 96;
const TELETRANSPORTES_EN_CURSO = new Set<string>();
const BLOQUES_PELIGROSOS = new Set([
  'minecraft:cactus',
  'minecraft:campfire',
  'minecraft:fire',
  'minecraft:magma',
  'minecraft:pointed_dripstone',
  'minecraft:powder_snow',
  'minecraft:soul_campfire',
  'minecraft:sweet_berry_bush',
]);

function esperar(ticks: number): Promise<void> {
  return new Promise((resolve) => system.runTimeout(resolve, ticks));
}

function coordenadasAleatorias(): { x: number; z: number } {
  const angulo = Math.random() * Math.PI * 2;
  const radio = Math.sqrt(
    DISTANCIA_MINIMA ** 2 + Math.random() * (DISTANCIA_MAXIMA ** 2 - DISTANCIA_MINIMA ** 2),
  );
  return {
    x: Math.floor(Math.cos(angulo) * radio),
    z: Math.floor(Math.sin(angulo) * radio),
  };
}

/** La barra de acción no crea la banda visual de título/subtítulo. */
async function mostrarCuentaRegresiva(player: Player): Promise<boolean> {
  for (let restantes = CUENTA_REGRESIVA_SEGUNDOS; restantes >= 1; restantes -= 1) {
    if (!player.isValid) return false;
    try {
      player.onScreenDisplay.setActionBar(`§eTeletransportando en §f${restantes}`);
    } catch {
      // El teletransporte no depende de que la interfaz esté disponible.
    }
    await esperar(20);
  }
  return player.isValid;
}

function mostrarEstado(player: Player, mensaje: string): void {
  try {
    player.onScreenDisplay.setActionBar(mensaje);
  } catch {
    // La interfaz es opcional para el flujo del teletransporte.
  }
}

function congelarDuranteTpr(player: Player, congelado: boolean): void {
  try {
    player.inputPermissions.setPermissionCategory(InputPermissionCategory.Movement, !congelado);
  } catch {
    // La protección física no depende de este bloqueo de controles.
  }
}

function protegerDuranteCarga(player: Player): void {
  try {
    player.addEffect('minecraft:slow_falling', 20 * 12, { showParticles: false });
    player.addEffect('minecraft:resistance', 20 * 12, { amplifier: 4, showParticles: false });
  } catch {
    // La altura temporal y los reintentos siguen evitando una caída larga.
  }
}

async function esperarChunkCargado(
  player: Player,
  dimension: Dimension,
  x: number,
  z: number,
  alturaTemporal: number,
): Promise<boolean> {
  for (let transcurridos = 0; transcurridos < MAX_ESPERA_TICKS; transcurridos += 2) {
    await esperar(2);
    if (!player.isValid || player.dimension.id !== dimension.id) return false;
    if (dimension.isChunkLoaded({ x, y: 64, z })) return true;
    try {
      player.teleport(
        { x: x + 0.5, y: alturaTemporal, z: z + 0.5 },
        { dimension, checkForBlocks: false, keepVelocity: false },
      );
    } catch {
      return false;
    }
  }
  return false;
}

function encontrarDestinoSeguro(
  dimension: Dimension,
  x: number,
  z: number,
): { x: number; y: number; z: number } | undefined {
  const superficie = dimension.getTopmostBlock({ x, z });
  if (
    !superficie ||
    superficie.isAir ||
    superficie.isLiquid ||
    BLOQUES_PELIGROSOS.has(superficie.typeId)
  ) return undefined;

  const destinoX = superficie.location.x;
  const destinoZ = superficie.location.z;
  const y = superficie.location.y + 1;
  const pies = dimension.getBlock({ x: destinoX, y, z: destinoZ });
  const cabeza = dimension.getBlock({ x: destinoX, y: y + 1, z: destinoZ });
  if (!pies?.isAir || !cabeza?.isAir) return undefined;
  return { x: destinoX + 0.5, y, z: destinoZ + 0.5 };
}

/** Prueba varias columnas ya cargadas antes de cambiar al jugador de región. */
function encontrarDestinoEnZonaCargada(
  dimension: Dimension,
  x: number,
  z: number,
): { x: number; y: number; z: number } | undefined {
  const columnas = [{ x, z }];
  for (let muestra = 0; muestra < MUESTRAS_POR_ZONA; muestra += 1) {
    columnas.push({
      x: x + Math.floor(Math.random() * (RADIO_BUSQUEDA_CARGADA * 2 + 1)) - RADIO_BUSQUEDA_CARGADA,
      z: z + Math.floor(Math.random() * (RADIO_BUSQUEDA_CARGADA * 2 + 1)) - RADIO_BUSQUEDA_CARGADA,
    });
  }

  for (const columna of columnas) {
    if (!dimension.isChunkLoaded({ x: columna.x, y: 64, z: columna.z })) continue;
    try {
      const destino = encontrarDestinoSeguro(dimension, columna.x, columna.z);
      if (destino) return destino;
    } catch {
      // Una columna vecina puede no estar disponible aunque la zona central ya esté cargada.
    }
  }
  return undefined;
}

async function buscarDestino(player: Player): Promise<void> {
  const dimension = world.getDimension('overworld');
  if (player.dimension.id !== dimension.id) {
    mostrarEstado(player, '§cTPR sólo está disponible en el mundo principal.');
    return;
  }

  const origen = { ...player.location };
  const alturaTemporal = dimension.heightRange.max - 2;
  const primerIntento = coordenadasAleatorias();

  if (!await mostrarCuentaRegresiva(player) || player.dimension.id !== dimension.id) return;
  congelarDuranteTpr(player, true);
  protegerDuranteCarga(player);

  try {
    for (let intento = 0; intento < MAX_INTENTOS; intento += 1) {
      const { x, z } = intento === 0 ? primerIntento : coordenadasAleatorias();
      try {
        // Este primer salto hace que Bedrock cargue el chunk en esas X/Z.
        player.teleport(
          { x: x + 0.5, y: alturaTemporal, z: z + 0.5 },
          { dimension, checkForBlocks: false, keepVelocity: false },
        );
        if (!await esperarChunkCargado(player, dimension, x, z, alturaTemporal)) continue;

        const destino = encontrarDestinoEnZonaCargada(dimension, x, z);
        if (!destino) continue;
        if (player.tryTeleport(destino, { dimension, checkForBlocks: true, keepVelocity: false })) {
          mostrarEstado(player, '');
          return;
        }
      } catch {
        // El chunk o el terreno no pudieron confirmarse; se prueba otra columna sin dejar al jugador caer.
      }
    }

    if (!player.isValid || player.dimension.id !== dimension.id) return;
    try {
      player.teleport(origen, { dimension, checkForBlocks: true, keepVelocity: false });
    } catch {
      // Si el origen dejó de ser válido, la protección temporal aún evita daño de caída.
    }
    mostrarEstado(player, '§cNo se encontró un destino seguro.');
  } finally {
    if (player.isValid) congelarDuranteTpr(player, false);
  }
}

export function teletransportarAleatoriamente(player: Player): void {
  const id = player.id;
  if (TELETRANSPORTES_EN_CURSO.has(id)) {
    mostrarEstado(player, '§eYa se está buscando un destino para ti.');
    return;
  }

  TELETRANSPORTES_EN_CURSO.add(id);
  void buscarDestino(player)
    .catch(() => {
      if (player.isValid) mostrarEstado(player, '§cNo se pudo completar el TPR.');
    })
    .finally(() => TELETRANSPORTES_EN_CURSO.delete(id));
}
