import { Player, system, world } from '@minecraft/server';
import { obtenerPvpActivo } from '../../global/configuracion.js';

export const DURACION_SOLICITUD_PVP_MS = 60_000;

export interface SolicitudPvp {
  retador: string;
  retado: string;
  expiraEn: number;
}

const solicitudesPorRetado = new Map<string, Map<string, SolicitudPvp>>();

function estaExpirada(solicitud: SolicitudPvp): boolean {
  return solicitud.expiraEn <= Date.now();
}

function buscarJugador(nombre: string): Player | undefined {
  return world.getPlayers().find((jugador) => jugador.name === nombre);
}

/** Elimina solicitudes caducadas o cuyo retador ya no está conectado. */
export function limpiarSolicitudesPvp(): void {
  for (const [retado, solicitudes] of solicitudesPorRetado) {
    for (const [retador, solicitud] of solicitudes) {
      if (estaExpirada(solicitud) || !buscarJugador(retador)) {
        solicitudes.delete(retador);
      }
    }

    if (solicitudes.size === 0) solicitudesPorRetado.delete(retado);
  }
}

export function crearSolicitudPvp(retador: Player, retado: Player): boolean {
  limpiarSolicitudesPvp();

  if (!obtenerPvpActivo()) return false;
  if (retador.name === retado.name) return false;

  const solicitudes = solicitudesPorRetado.get(retado.name) ?? new Map<string, SolicitudPvp>();
  if (solicitudes.has(retador.name)) return false;

  solicitudes.set(retador.name, {
    retador: retador.name,
    retado: retado.name,
    expiraEn: Date.now() + DURACION_SOLICITUD_PVP_MS,
  });
  solicitudesPorRetado.set(retado.name, solicitudes);
  return true;
}

export function obtenerSolicitudesPvp(retado: Player): SolicitudPvp[] {
  limpiarSolicitudesPvp();
  return [...(solicitudesPorRetado.get(retado.name)?.values() ?? [])];
}

export function responderSolicitudPvp(
  retado: Player,
  retadorNombre: string,
  aceptar: boolean,
): 'aceptada' | 'rechazada' | 'caducada' {
  limpiarSolicitudesPvp();
  const solicitudes = solicitudesPorRetado.get(retado.name);
  const solicitud = solicitudes?.get(retadorNombre);

  if (!solicitud || estaExpirada(solicitud)) return 'caducada';

  solicitudes?.delete(retadorNombre);
  if (solicitudes?.size === 0) solicitudesPorRetado.delete(retado.name);

  return aceptar ? 'aceptada' : 'rechazada';
}

// La limpieza no depende de que alguien abra un menú.
system.runInterval(limpiarSolicitudesPvp, 20 * 10);
