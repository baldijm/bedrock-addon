import { Entity, EntityProjectileComponent, Player, system } from '@minecraft/server';

export const NOMBRE_TRIGGER_GUN = 'Gun';

const ID_PROYECTIL_ENERGIA = 'spb:energy_bolt';
const DANIO_GUN = 6;
const VELOCIDAD_GUN = 1.8;
const RECARGA_GUN_TICKS = 6;
const VIDA_PROYECTIL_TICKS = 20 * 3;

type ProyectilActivo = {
  entidad: Entity;
  expiraEn: number;
};

const ultimoDisparoPorJugador = new Map<string, number>();
const proyectilesActivos = new Map<string, ProyectilActivo>();
function mostrarRastroDeEnergia(): void {
  for (const [id, proyectil] of proyectilesActivos) {
    try {
      if (system.currentTick >= proyectil.expiraEn) {
        proyectil.entidad.remove();
        proyectilesActivos.delete(id);
        continue;
      }

      // Partícula vanilla sin parámetros: compatible con todas las versiones objetivo.
      proyectil.entidad.dimension.spawnParticle(
        'minecraft:basic_flame_particle',
        proyectil.entidad.location,
      );
    } catch {
      // El proyectil ya impactó o fue eliminado por el mundo.
      proyectilesActivos.delete(id);
    }
  }
}

/** Dispara un bolt de energía. Esta base se reutilizará para guantes y báculos. */
export function dispararEnergia(player: Player): boolean {
  const ultimoDisparo = ultimoDisparoPorJugador.get(player.id) ?? -RECARGA_GUN_TICKS;
  if (system.currentTick - ultimoDisparo < RECARGA_GUN_TICKS) return false;

  const direccion = player.getViewDirection();
  const cabeza = player.getHeadLocation();
  const origen = {
    x: cabeza.x + direccion.x * 0.8,
    y: cabeza.y + direccion.y * 0.8,
    z: cabeza.z + direccion.z * 0.8,
  };
  const proyectil = player.dimension.spawnEntity(ID_PROYECTIL_ENERGIA, origen);
  const componente = proyectil.getComponent('minecraft:projectile') as
    | EntityProjectileComponent
    | undefined;

  if (!componente) {
    proyectil.remove();
    throw new Error('El proyectil de energía no tiene el componente projectile.');
  }

  componente.owner = player;
  componente.shoot({
    x: direccion.x * VELOCIDAD_GUN,
    y: direccion.y * VELOCIDAD_GUN,
    z: direccion.z * VELOCIDAD_GUN,
  });

  ultimoDisparoPorJugador.set(player.id, system.currentTick);
  proyectilesActivos.set(proyectil.id, {
    entidad: proyectil,
    expiraEn: system.currentTick + VIDA_PROYECTIL_TICKS,
  });
  player.dimension.playSound('random.orb', origen, { volume: 0.8, pitch: 1.7 });
  return true;
}

export function esTriggerGun(typeId: string, nameTag?: string): boolean {
  return typeId === 'minecraft:bread' && nameTag === NOMBRE_TRIGGER_GUN;
}

// El daño está definido por la entidad; esta constante documenta el perfil inicial del Gun.
export const PERFIL_GUN = { danio: DANIO_GUN, recargaTicks: RECARGA_GUN_TICKS };

system.runInterval(mostrarRastroDeEnergia);
