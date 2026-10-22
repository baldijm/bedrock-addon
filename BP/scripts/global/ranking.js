import { world } from '@minecraft/server';
export const OBJETIVO_PUNTOS = 'spb_puntos';
const PROPIEDAD_NOMBRES_RANKING = 'spb:nombres_ranking';
function obtenerObjetivoPuntos() {
    let objetivo = world.scoreboard.getObjective(OBJETIVO_PUNTOS);
    if (!objetivo) {
        objetivo = world.scoreboard.addObjective(OBJETIVO_PUNTOS, 'SPB Puntos');
    }
    return objetivo;
}
function obtenerNombresGuardados() {
    const valor = world.getDynamicProperty(PROPIEDAD_NOMBRES_RANKING);
    if (typeof valor !== 'string')
        return {};
    try {
        const nombres = JSON.parse(valor);
        return nombres && typeof nombres === 'object' && !Array.isArray(nombres)
            ? nombres
            : {};
    }
    catch {
        return {};
    }
}
function guardarNombreJugador(player) {
    const id = player.scoreboardIdentity?.id;
    if (id === undefined)
        return;
    const nombres = obtenerNombresGuardados();
    if (nombres[String(id)] === player.name)
        return;
    nombres[String(id)] = player.name;
    world.setDynamicProperty(PROPIEDAD_NOMBRES_RANKING, JSON.stringify(nombres));
}
/** Registra al jugador con 0 puntos la primera vez que entra. */
export function asegurarJugadorEnRanking(player) {
    const objetivo = obtenerObjetivoPuntos();
    const esJugadorNuevo = !objetivo.hasParticipant(player);
    if (esJugadorNuevo) {
        objetivo.setScore(player, 0);
    }
    guardarNombreJugador(player);
    return esJugadorNuevo;
}
function obtenerPuestoGlobal(player, objetivo) {
    const puntos = objetivo.getScore(player) ?? 0;
    const jugadoresPorEncima = objetivo
        .getScores()
        .filter((entrada) => entrada.score > puntos).length;
    return jugadoresPorEncima + 1;
}
export function obtenerResumenJugador(player) {
    asegurarJugadorEnRanking(player);
    const objetivo = obtenerObjetivoPuntos();
    return {
        puntos: objetivo.getScore(player) ?? 0,
        puesto: obtenerPuestoGlobal(player, objetivo),
    };
}
/** Muestra información personal que no se comparte con otros jugadores. */
export function actualizarResumenRanking(player) {
    const { puntos, puesto } = obtenerResumenJugador(player);
    player.onScreenDisplay.setActionBar(`§6Posición: §f#${puesto}   §bPuntos: §f${puntos}`);
}
/**
 * Punto único para entregar puntos desde futuras mecánicas del addon.
 * También refresca el resumen del jugador que recibió los puntos.
 */
export function agregarPuntos(player, cantidad) {
    asegurarJugadorEnRanking(player);
    const total = obtenerObjetivoPuntos().addScore(player, cantidad);
    actualizarResumenRanking(player);
    return total;
}
/** Devuelve todos los participantes históricos guardados en spb_puntos. */
export function obtenerRankingCompleto() {
    const objetivo = obtenerObjetivoPuntos();
    const registros = objetivo.getScores();
    const nombres = obtenerNombresGuardados();
    return registros
        .map((entrada) => ({
        nombre: nombres[String(entrada.participant.id)] ?? entrada.participant.displayName,
        puntos: entrada.score,
        puesto: registros.filter((otraEntrada) => otraEntrada.score > entrada.score).length + 1,
    }))
        .sort((a, b) => b.puntos - a.puntos || a.nombre.localeCompare(b.nombre));
}
//# sourceMappingURL=ranking.js.map