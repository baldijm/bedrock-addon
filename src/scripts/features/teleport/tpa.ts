import { Player, system, world } from '@minecraft/server';

export const DURACION_SOLICITUD_TPA_MS = 60_000;

export type TipoSolicitudTpa = 'unirse' | 'invitar';

export interface SolicitudTpa {
  solicitante: string;
  destinatario: string;
  tipo: TipoSolicitudTpa;
  expiraEn: number;
}

const solicitudesPorDestinatario = new Map<string, Map<string, SolicitudTpa>>();

function estaExpirada(solicitud: SolicitudTpa): boolean {
  return solicitud.expiraEn <= Date.now();
}

function buscarJugador(nombre: string): Player | undefined {
  return world.getPlayers().find((jugador) => jugador.name === nombre);
}

/** Elimina solicitudes caducadas o cuyo solicitante ya se desconectó. */
export function limpiarSolicitudesTpa(): void {
  for (const [destinatario, solicitudes] of solicitudesPorDestinatario) {
    for (const [solicitante, solicitud] of solicitudes) {
      if (estaExpirada(solicitud) || !buscarJugador(solicitante)) {
        solicitudes.delete(solicitante);
      }
    }

    if (solicitudes.size === 0) solicitudesPorDestinatario.delete(destinatario);
  }
}

export function crearSolicitudTpa(
  solicitante: Player,
  destinatario: Player,
  tipo: TipoSolicitudTpa,
): boolean {
  limpiarSolicitudesTpa();

  if (solicitante.name === destinatario.name) return false;

  const solicitudes =
    solicitudesPorDestinatario.get(destinatario.name) ?? new Map<string, SolicitudTpa>();
  if (solicitudes.has(solicitante.name)) return false;

  solicitudes.set(solicitante.name, {
    solicitante: solicitante.name,
    destinatario: destinatario.name,
    tipo,
    expiraEn: Date.now() + DURACION_SOLICITUD_TPA_MS,
  });
  solicitudesPorDestinatario.set(destinatario.name, solicitudes);
  return true;
}

export function obtenerSolicitudesTpa(destinatario: Player): SolicitudTpa[] {
  limpiarSolicitudesTpa();
  return [...(solicitudesPorDestinatario.get(destinatario.name)?.values() ?? [])];
}

/** Devuelve la solicitud procesada o undefined si ya no está disponible. */
export function responderSolicitudTpa(
  destinatario: Player,
  solicitanteNombre: string,
): SolicitudTpa | undefined {
  limpiarSolicitudesTpa();
  const solicitudes = solicitudesPorDestinatario.get(destinatario.name);
  const solicitud = solicitudes?.get(solicitanteNombre);

  if (!solicitud || estaExpirada(solicitud)) return undefined;

  solicitudes?.delete(solicitanteNombre);
  if (solicitudes?.size === 0) solicitudesPorDestinatario.delete(destinatario.name);
  return solicitud;
}

system.runInterval(limpiarSolicitudesTpa, 20 * 10);
