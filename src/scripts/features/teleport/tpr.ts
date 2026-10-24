import { system, type Player, world } from '@minecraft/server';

const DISTANCIA_MINIMA = 300;
const DISTANCIA_MAXIMA = 2500;
const MAX_INTENTOS = 6;
const MAX_ESPERA_TICKS = 100;
const RADIO_CARGA = 16;
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

async function buscarDestino(player: Player): Promise<void> {
  const dimension = world.getDimension('overworld');
  if (player.dimension.id !== dimension.id) {
    player.sendMessage('§cTPR sólo está disponible en el mundo principal.');
    return;
  }

  player.sendMessage('§eBuscando un destino seguro…');

  for (let intento = 0; intento < MAX_INTENTOS; intento += 1) {
    const { x, z } = coordenadasAleatorias();
    const nombreArea = `spb_tpr_${player.id.replace(/[^a-zA-Z0-9_]/g, '').slice(-8)}_${intento}`;
    let areaCreada = false;
    try {
      dimension.runCommand(
        `tickingarea add ${x - RADIO_CARGA} 0 ${z - RADIO_CARGA} ${x + RADIO_CARGA} 0 ${z + RADIO_CARGA} ${nombreArea} true`,
      );
      areaCreada = true;

      for (let transcurridos = 0; transcurridos < MAX_ESPERA_TICKS; transcurridos += 2) {
        await esperar(2);
        if (!player.isValid || player.dimension.id !== dimension.id) return;
        if (!dimension.isChunkLoaded({ x, y: 64, z })) continue;

        const superficie = dimension.getTopmostBlock({ x, z });
        if (
          !superficie ||
          superficie.isAir ||
          superficie.isLiquid ||
          BLOQUES_PELIGROSOS.has(superficie.typeId)
        ) break;

        const destinoX = superficie.location.x;
        const destinoZ = superficie.location.z;
        const y = superficie.location.y + 1;
        const pies = dimension.getBlock({ x: destinoX, y, z: destinoZ });
        const cabeza = dimension.getBlock({ x: destinoX, y: y + 1, z: destinoZ });
        if (!pies?.isAir || !cabeza?.isAir) break;

        if (player.tryTeleport(
          { x: destinoX + 0.5, y, z: destinoZ + 0.5 },
          { dimension, checkForBlocks: true, keepVelocity: false },
        )) {
          player.sendMessage('§aTe teletransportaste a una ubicación segura.');
          return;
        }
        break;
      }
    } catch {
      // El destino o su chunk no están listos; se prueba otro sin mover al jugador.
    } finally {
      if (areaCreada) {
        try {
          dimension.runCommand(`tickingarea remove ${nombreArea}`);
        } catch {
          // El servidor pudo eliminar el área durante una recarga.
        }
      }
    }
  }

  if (player.isValid) player.sendMessage('§cNo se encontró un destino seguro. No se realizó el TPR.');
}

export function teletransportarAleatoriamente(player: Player): void {
  const id = player.id;
  if (TELETRANSPORTES_EN_CURSO.has(id)) {
    player.sendMessage('§eYa se está buscando un destino para ti.');
    return;
  }

  TELETRANSPORTES_EN_CURSO.add(id);
  void buscarDestino(player)
    .catch(() => {
      if (player.isValid) player.sendMessage('§cNo se pudo completar la búsqueda de un destino.');
    })
    .finally(() => TELETRANSPORTES_EN_CURSO.delete(id));
}
