import { system, world } from '@minecraft/server';
export const DURACION_SOLICITUD_TPA_MS = 60_000;
const solicitudesPorDestinatario = new Map();
function estaExpirada(solicitud) {
    return solicitud.expiraEn <= Date.now();
}
function buscarJugador(nombre) {
    return world.getPlayers().find((jugador) => jugador.name === nombre);
}
/** Elimina solicitudes caducadas o cuyo solicitante ya se desconectó. */
export function limpiarSolicitudesTpa() {
    for (const [destinatario, solicitudes] of solicitudesPorDestinatario) {
        for (const [solicitante, solicitud] of solicitudes) {
            if (estaExpirada(solicitud) || !buscarJugador(solicitante)) {
                solicitudes.delete(solicitante);
            }
        }
        if (solicitudes.size === 0)
            solicitudesPorDestinatario.delete(destinatario);
    }
}
export function crearSolicitudTpa(solicitante, destinatario, tipo) {
    limpiarSolicitudesTpa();
    if (solicitante.name === destinatario.name)
        return false;
    const solicitudes = solicitudesPorDestinatario.get(destinatario.name) ?? new Map();
    if (solicitudes.has(solicitante.name))
        return false;
    solicitudes.set(solicitante.name, {
        solicitante: solicitante.name,
        destinatario: destinatario.name,
        tipo,
        expiraEn: Date.now() + DURACION_SOLICITUD_TPA_MS,
    });
    solicitudesPorDestinatario.set(destinatario.name, solicitudes);
    return true;
}
export function obtenerSolicitudesTpa(destinatario) {
    limpiarSolicitudesTpa();
    return [...(solicitudesPorDestinatario.get(destinatario.name)?.values() ?? [])];
}
/** Devuelve la solicitud procesada o undefined si ya no está disponible. */
export function responderSolicitudTpa(destinatario, solicitanteNombre) {
    limpiarSolicitudesTpa();
    const solicitudes = solicitudesPorDestinatario.get(destinatario.name);
    const solicitud = solicitudes?.get(solicitanteNombre);
    if (!solicitud || estaExpirada(solicitud))
        return undefined;
    solicitudes?.delete(solicitanteNombre);
    if (solicitudes?.size === 0)
        solicitudesPorDestinatario.delete(destinatario.name);
    return solicitud;
}
system.runInterval(limpiarSolicitudesTpa, 20 * 10);
//# sourceMappingURL=tpa.js.map