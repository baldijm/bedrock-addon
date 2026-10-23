import { world } from '@minecraft/server';
const PROPIEDAD_PUNTOS_ELIMINACION = 'spb:puntos_eliminacion';
const PROPIEDAD_CREATIVE_PLUS = 'spb:creative_plus';
const PROPIEDAD_PVP_ACTIVO = 'spb:pvp_activo';
const PUNTOS_ELIMINACION_PREDETERMINADOS = 10;
/** Devuelve los puntos que recibe un jugador al conseguir una eliminación. */
export function obtenerPuntosPorEliminacion() {
    const valor = world.getDynamicProperty(PROPIEDAD_PUNTOS_ELIMINACION);
    if (typeof valor !== 'number' || !Number.isFinite(valor) || valor < 0) {
        return PUNTOS_ELIMINACION_PREDETERMINADOS;
    }
    return Math.floor(valor);
}
/** Guarda la configuración en el mundo para conservarla entre reinicios. */
export function establecerPuntosPorEliminacion(puntos) {
    if (!Number.isSafeInteger(puntos) || puntos < 0) {
        throw new Error('Los puntos por eliminación deben ser un número entero igual o mayor que 0.');
    }
    world.setDynamicProperty(PROPIEDAD_PUNTOS_ELIMINACION, puntos);
}
/** Indica si los administradores en creativo reemplazan bloques al golpearlos. */
export function obtenerCreativePlus() {
    return world.getDynamicProperty(PROPIEDAD_CREATIVE_PLUS) === true;
}
/** Guarda el estado de Creative+ en el mundo para conservarlo entre reinicios. */
export function establecerCreativePlus(activo) {
    world.setDynamicProperty(PROPIEDAD_CREATIVE_PLUS, activo);
}
/** PvP se mantiene activo por defecto para no cambiar mundos ya existentes. */
export function obtenerPvpActivo() {
    return world.getDynamicProperty(PROPIEDAD_PVP_ACTIVO) !== false;
}
/** Guarda si los jugadores pueden iniciar retos PvP nuevos. */
export function establecerPvpActivo(activo) {
    world.setDynamicProperty(PROPIEDAD_PVP_ACTIVO, activo);
}
//# sourceMappingURL=configuracion.js.map