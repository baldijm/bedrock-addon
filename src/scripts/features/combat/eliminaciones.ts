import { Entity, EntityDamageSource, EntityProjectileComponent, Player, system, world } from '@minecraft/server';
import { obtenerPuntosPorEliminacion } from '../../global/configuracion.js';
import { agregarPuntos } from '../../global/ranking.js';
import { obtenerPuntosPorEliminacionArena } from '../games/arenaPvp.js';

const VENTANA_CREDITO_TICKS = 20 * 3;

type CreditoDeCombate = {
  atacante: string;
  tick: number;
};

const ultimoAtacantePorVictima = new Map<string, CreditoDeCombate>();

function esJugador(entidad: Entity | undefined): entidad is Player {
  return entidad?.typeId === 'minecraft:player';
}

function obtenerAtacante(source: EntityDamageSource): Player | undefined {
  if (esJugador(source.damagingEntity)) return source.damagingEntity;

  const proyectil = source.damagingProjectile;
  if (!proyectil) return undefined;

  const componente = proyectil.getComponent('minecraft:projectile') as
    | EntityProjectileComponent
    | undefined;
  return esJugador(componente?.owner) ? componente.owner : undefined;
}

function buscarJugadorConectado(nombre: string): Player | undefined {
  return world.getPlayers().find((jugador) => jugador.name === nombre);
}

world.afterEvents.entityHurt.subscribe((event) => {
  if (!esJugador(event.hurtEntity)) return;

  const atacante = obtenerAtacante(event.damageSource);
  if (!atacante || atacante.name === event.hurtEntity.name) return;

  ultimoAtacantePorVictima.set(event.hurtEntity.id, {
    atacante: atacante.name,
    tick: system.currentTick,
  });
});

world.afterEvents.entityDie.subscribe((event) => {
  if (!esJugador(event.deadEntity)) return;

  const victima = event.deadEntity;
  const creditoGuardado = ultimoAtacantePorVictima.get(victima.id);
  ultimoAtacantePorVictima.delete(victima.id);

  const atacanteDirecto = obtenerAtacante(event.damageSource);
  const creditoVigente =
    creditoGuardado && system.currentTick - creditoGuardado.tick <= VENTANA_CREDITO_TICKS
      ? buscarJugadorConectado(creditoGuardado.atacante)
      : undefined;
  const killer = atacanteDirecto ?? creditoVigente;

  if (!killer || killer.name === victima.name) return;

  const puntos = obtenerPuntosPorEliminacionArena(killer, victima) ?? obtenerPuntosPorEliminacion();
  agregarPuntos(killer, puntos);
  killer.sendMessage(`§aEliminaste a §f${victima.name}§a. +§f${puntos}§a puntos.`);
});
