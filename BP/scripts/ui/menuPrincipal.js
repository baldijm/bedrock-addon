import { world } from '@minecraft/server';
import { ActionFormData } from '@minecraft/server-ui';
import { DURACION_SOLICITUD_PVP_MS, crearSolicitudPvp, obtenerSolicitudesPvp, responderSolicitudPvp, } from '../pvp.js';
import { obtenerRankingConectados, obtenerResumenJugador } from '../ranking.js';
export function abrirMenuPrincipal(player) {
    const { puntos, puesto } = obtenerResumenJugador(player);
    const form = new ActionFormData()
        .title('§6§lSecret Kingdom')
        .body([
        `§e${player.name}`,
        '§7━━━━━━━━━━━━━━━━',
        `§6Posición global: §f#${puesto}`,
        `§bPuntos: §f${puntos}`,
    ].join('\n'))
        .button('PvP')
        .button('Ranking');
    form
        .show(player)
        .then((respuesta) => {
        if (respuesta.canceled)
            return;
        if (respuesta.selection === 0) {
            abrirMenuPvp(player);
        }
        if (respuesta.selection === 1) {
            abrirRanking(player);
        }
    })
        .catch((error) => {
        player.sendMessage(`§cError al abrir menú: ${String(error)}`);
    });
}
function abrirMenuPvp(player) {
    const solicitudes = obtenerSolicitudesPvp(player);
    new ActionFormData()
        .title('§c§lPvP')
        .body('§7Elige qué quieres hacer.')
        .button('§cRetar jugador')
        .button(`§eSolicitudes (§f${solicitudes.length}§e)`)
        .button('§7Volver')
        .show(player)
        .then((respuesta) => {
        if (respuesta.canceled || respuesta.selection === 2)
            return;
        if (respuesta.selection === 0)
            abrirListaDeRetos(player);
        if (respuesta.selection === 1)
            abrirSolicitudesPvp(player);
    })
        .catch((error) => player.sendMessage(`§cError al abrir PvP: ${String(error)}`));
}
function abrirListaDeRetos(player) {
    const jugadores = world.getPlayers().filter((jugador) => jugador.name !== player.name);
    const form = new ActionFormData()
        .title('§c§lRetar jugador')
        .body(jugadores.length > 0 ? '§7Selecciona a un jugador conectado.' : '§7No hay otros jugadores conectados.')
        .button('§7Volver');
    for (const jugador of jugadores)
        form.button(`§f${jugador.name}`);
    form
        .show(player)
        .then((respuesta) => {
        if (respuesta.canceled || respuesta.selection === undefined || respuesta.selection === 0)
            return;
        const retado = jugadores[respuesta.selection - 1];
        const retadoActual = retado && world.getPlayers().find((jugador) => jugador.name === retado.name);
        if (!retadoActual) {
            player.sendMessage('§cEse jugador ya no está conectado.');
            return;
        }
        if (!crearSolicitudPvp(player, retadoActual)) {
            player.sendMessage(`§eYa tienes una solicitud activa para §f${retadoActual.name}§e.`);
            return;
        }
        const segundos = DURACION_SOLICITUD_PVP_MS / 1000;
        player.sendMessage(`§aReto enviado a §f${retadoActual.name}§a. Caduca en ${segundos} segundos.`);
        retadoActual.sendMessage(`§c${player.name} §fte ha retado a PvP. §eAbre PvP > Solicitudes para responder.`);
    })
        .catch((error) => player.sendMessage(`§cError al elegir rival: ${String(error)}`));
}
function abrirSolicitudesPvp(player) {
    const solicitudes = obtenerSolicitudesPvp(player);
    const form = new ActionFormData()
        .title('§e§lSolicitudes de PvP')
        .body(solicitudes.length > 0 ? '§7Selecciona una solicitud para responder.' : '§7No tienes solicitudes activas.')
        .button('§7Volver');
    for (const solicitud of solicitudes)
        form.button(`§c${solicitud.retador}`);
    form
        .show(player)
        .then((respuesta) => {
        if (respuesta.canceled || respuesta.selection === undefined || respuesta.selection === 0)
            return;
        const solicitud = solicitudes[respuesta.selection - 1];
        if (solicitud)
            abrirRespuestaSolicitud(player, solicitud.retador);
    })
        .catch((error) => player.sendMessage(`§cError al abrir solicitudes: ${String(error)}`));
}
function abrirRespuestaSolicitud(retado, retadorNombre) {
    new ActionFormData()
        .title('§c§lReto de PvP')
        .body(`§f${retadorNombre} §7quiere combatir contigo.`)
        .button('§aAceptar')
        .button('§cRechazar')
        .button('§7Volver')
        .show(retado)
        .then((respuesta) => {
        if (respuesta.canceled || respuesta.selection === 2)
            return;
        const aceptar = respuesta.selection === 0;
        const resultado = responderSolicitudPvp(retado, retadorNombre, aceptar);
        if (resultado === 'caducada') {
            retado.sendMessage('§eEsta solicitud ya caducó.');
            return;
        }
        const retador = world.getPlayers().find((jugador) => jugador.name === retadorNombre);
        if (aceptar) {
            retado.sendMessage(`§aAceptaste el reto de §f${retadorNombre}§a.`);
            retador?.sendMessage(`§a${retado.name} aceptó tu reto de PvP.`);
        }
        else {
            retado.sendMessage(`§cRechazaste el reto de §f${retadorNombre}§c.`);
            retador?.sendMessage(`§c${retado.name} rechazó tu reto de PvP.`);
        }
    })
        .catch((error) => retado.sendMessage(`§cError al responder el reto: ${String(error)}`));
}
function abrirRanking(player) {
    const entradas = obtenerRankingConectados();
    const lineas = entradas.map((entrada) => {
        const nombre = entrada.nombre === player.name ? `§e${entrada.nombre} §7(Tú)` : `§f${entrada.nombre}`;
        return `§6#${entrada.puesto}  ${nombre}  §b${entrada.puntos} pts`;
    });
    new ActionFormData()
        .title('§6§lRanking')
        .body(lineas.length > 0 ? lineas.join('\n') : '§7No hay jugadores conectados.')
        .button('Cerrar')
        .show(player)
        .catch((error) => {
        player.sendMessage(`§cError al abrir ranking: ${String(error)}`);
    });
}
//# sourceMappingURL=menuPrincipal.js.map