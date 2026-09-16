import { world } from '@minecraft/server';
export const OBJETIVO_PUNTOS = 'spb_puntos';
function obtenerObjetivoPuntos() {
    let objetivo = world.scoreboard.getObjective(OBJETIVO_PUNTOS);
    if (!objetivo) {
        objetivo = world.scoreboard.addObjective(OBJETIVO_PUNTOS, 'SPB Puntos');
    }
    return objetivo;
}
/** Registra al jugador con 0 puntos la primera vez que entra. */
export function asegurarJugadorEnRanking(player) {
    const objetivo = obtenerObjetivoPuntos();
    if (!objetivo.hasParticipant(player)) {
        objetivo.setScore(player, 0);
    }
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
    player.onScreenDisplay.setActionBar(`§6Rango: §f#${puesto}   §bPuntos: §f${puntos}`);
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
/**
 * Devuelve exclusivamente jugadores conectados, pero su puesto se calcula
 * contra todos los participantes históricos de spb_puntos.
 */
export function obtenerRankingConectados() {
    const objetivo = obtenerObjetivoPuntos();
    return world
        .getPlayers()
        .map((player) => {
        asegurarJugadorEnRanking(player);
        return {
            nombre: player.name,
            puntos: objetivo.getScore(player) ?? 0,
            puesto: obtenerPuestoGlobal(player, objetivo),
        };
    })
        .sort((a, b) => b.puntos - a.puntos || a.nombre.localeCompare(b.nombre));
}
//# sourceMappingURL=ranking.js.map