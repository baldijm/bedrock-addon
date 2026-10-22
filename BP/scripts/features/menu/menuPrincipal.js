import { GameMode, world } from '@minecraft/server';
import { ActionFormData } from '@minecraft/server-ui';
import { ModalFormData } from '@minecraft/server-ui';
import { establecerCreativePlus, establecerPuntosPorEliminacion, obtenerCreativePlus, obtenerPuntosPorEliminacion } from '../../global/configuracion.js';
import { DURACION_SOLICITUD_PVP_MS, crearSolicitudPvp, obtenerSolicitudesPvp, responderSolicitudPvp } from '../pvp/pvp.js';
import { hayPartidaArenaActiva, iniciarPartidaArena } from '../games/arenaPvp.js';
import { DURACION_SOLICITUD_TPA_MS, crearSolicitudTpa, obtenerSolicitudesTpa, responderSolicitudTpa } from '../teleport/tpa.js';
import { obtenerRankingCompleto, obtenerResumenJugador } from '../../global/ranking.js';
function esAdministrador(player) {
    return player.hasTag('op');
}
export function abrirMenuPrincipal(player) {
    const { puntos, puesto } = obtenerResumenJugador(player);
    const form = new ActionFormData()
        .title('§lSecret Kingdom')
        .body([
        `§e${player.name}`,
        '§f━━━━━━━━━━━━━━━━',
        `§6Posición global: §f#${puesto}`,
        `§bPuntos: §f${puntos}`
    ].join('\n'))
        .button('Ranking')
        .button('PvP')
        .button('TPA');
    if (esAdministrador(player)) {
        form.button('Settings');
        form.button('Gamemode');
    }
    form
        .show(player)
        .then((respuesta) => {
        if (respuesta.canceled)
            return;
        if (respuesta.selection === 0) {
            abrirRanking(player);
        }
        if (respuesta.selection === 1) {
            abrirMenuPvp(player);
        }
        if (respuesta.selection === 2) {
            abrirMenuTpa(player);
        }
        if (respuesta.selection === 3 && esAdministrador(player)) {
            abrirMenuSettings(player);
            return;
        }
        if (respuesta.selection === 4 && esAdministrador(player)) {
            abrirMenuGamemode(player);
        }
    })
        .catch((error) => {
        player.sendMessage(`§cError al abrir menú: ${String(error)}`);
    });
}
function abrirMenuGamemode(player) {
    if (!esAdministrador(player))
        return;
    new ActionFormData()
        .title('§f§lGamemode')
        .body('§fSelecciona tu modo de juego.')
        .button('§aSurvival')
        .button('§bCreative')
        .button('§dSpectator')
        .button('§6Adventure')
        .button('Regresar')
        .show(player)
        .then((respuesta) => {
        if (respuesta.canceled || respuesta.selection === undefined)
            return;
        if (!esAdministrador(player))
            return;
        const modos = [
            GameMode.Survival,
            GameMode.Creative,
            GameMode.Spectator,
            GameMode.Adventure,
        ];
        const nombres = ['Survival', 'Creative', 'Spectator', 'Adventure'];
        const modo = modos[respuesta.selection];
        if (modo) {
            player.setGameMode(modo);
            player.sendMessage(`§aModo de juego cambiado a §f${nombres[respuesta.selection]}§a.`);
            return;
        }
        if (respuesta.selection === 4)
            abrirMenuPrincipal(player);
    })
        .catch((error) => player.sendMessage(`§cError al cambiar gamemode: ${String(error)}`));
}
function abrirMenuSettings(player) {
    if (!esAdministrador(player))
        return;
    const puntosActuales = obtenerPuntosPorEliminacion();
    const creativePlusActivo = obtenerCreativePlus();
    new ActionFormData()
        .title('§f§lSettings')
        .body('§fAdministra la configuración global del servidor.')
        .button(`§fPuntos por kill: §e${puntosActuales}`)
        .button(`§fCreative+: ${creativePlusActivo ? '§aActivo' : '§cInactivo'}`)
        .button('Regresar')
        .show(player)
        .then((respuesta) => {
        if (respuesta.canceled)
            return;
        if (respuesta.selection === 0) {
            abrirEditorPuntosPorEliminacion(player, puntosActuales);
            return;
        }
        if (respuesta.selection === 1) {
            const nuevoEstado = !creativePlusActivo;
            establecerCreativePlus(nuevoEstado);
            player.sendMessage(`§aCreative+ ${nuevoEstado ? 'activado' : 'desactivado'}§a.`);
            abrirMenuSettings(player);
            return;
        }
        if (respuesta.selection === 2)
            abrirMenuPrincipal(player);
    })
        .catch((error) => player.sendMessage(`§cError al guardar settings: ${String(error)}`));
}
function abrirEditorPuntosPorEliminacion(player, puntosActuales) {
    new ModalFormData()
        .title('§f§lPuntos por kill')
        .textField('§fPuntos por kill', 'Ej.: 10', {
        defaultValue: String(puntosActuales)
    })
        .submitButton('§aGuardar')
        .show(player)
        .then((respuesta) => {
        if (respuesta.canceled) {
            abrirMenuSettings(player);
            return;
        }
        const texto = respuesta.formValues?.[0];
        const puntos = typeof texto === 'string' ? Number(texto.trim()) : Number.NaN;
        if (!Number.isSafeInteger(puntos) || puntos < 0) {
            player.sendMessage('§cIngresa un número entero igual o mayor que 0.');
            abrirEditorPuntosPorEliminacion(player, puntosActuales);
            return;
        }
        establecerPuntosPorEliminacion(puntos);
        player.sendMessage(`§aPuntos por eliminación actualizados a §f${puntos}§a.`);
        abrirMenuSettings(player);
    })
        .catch((error) => player.sendMessage(`§cError al guardar settings: ${String(error)}`));
}
function abrirMenuPvp(player) {
    const solicitudes = obtenerSolicitudesPvp(player);
    new ActionFormData()
        .title('§c§lPvP')
        .body('§fElige qué quieres hacer.')
        .button('§cRetar jugador')
        .button(`§eSolicitudes (§f${solicitudes.length}§e)`)
        .button('Volver')
        .show(player)
        .then((respuesta) => {
        if (respuesta.canceled)
            return;
        if (respuesta.selection === 2) {
            abrirMenuPrincipal(player);
            return;
        }
        if (respuesta.selection === 0)
            abrirListaDeRetos(player);
        if (respuesta.selection === 1)
            abrirSolicitudesPvp(player);
    })
        .catch((error) => player.sendMessage(`§cError al abrir PvP: ${String(error)}`));
}
function abrirListaDeRetos(player) {
    if (hayPartidaArenaActiva()) {
        player.sendMessage('§eLa arena PvP ya está ocupada por otra partida.');
        return;
    }
    const jugadores = world.getPlayers().filter((jugador) => jugador.name !== player.name);
    const form = new ActionFormData()
        .title('§c§lRetar jugador')
        .body(jugadores.length > 0
        ? '§fSelecciona a un jugador conectado.'
        : '§fNo hay otros jugadores conectados.');
    for (const jugador of jugadores)
        form.button(`§f${jugador.name}`);
    form.button('Volver');
    form
        .show(player)
        .then((respuesta) => {
        if (respuesta.canceled || respuesta.selection === undefined)
            return;
        if (respuesta.selection === jugadores.length) {
            abrirMenuPvp(player);
            return;
        }
        const retado = jugadores[respuesta.selection];
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
        .body(solicitudes.length > 0
        ? '§fSelecciona una solicitud para responder.'
        : '§fNo tienes solicitudes activas.');
    for (const solicitud of solicitudes)
        form.button(`§c${solicitud.retador}`);
    form.button('Volver');
    form
        .show(player)
        .then((respuesta) => {
        if (respuesta.canceled || respuesta.selection === undefined)
            return;
        if (respuesta.selection === solicitudes.length) {
            abrirMenuPvp(player);
            return;
        }
        const solicitud = solicitudes[respuesta.selection];
        if (solicitud)
            abrirRespuestaSolicitud(player, solicitud.retador);
    })
        .catch((error) => player.sendMessage(`§cError al abrir solicitudes: ${String(error)}`));
}
function abrirRespuestaSolicitud(retado, retadorNombre) {
    new ActionFormData()
        .title('§c§lReto de PvP')
        .body(`§f${retadorNombre} §fquiere combatir contigo.`)
        .button('§aAceptar')
        .button('§cRechazar')
        .button('Volver')
        .show(retado)
        .then((respuesta) => {
        if (respuesta.canceled)
            return;
        if (respuesta.selection === 2) {
            abrirSolicitudesPvp(retado);
            return;
        }
        const aceptar = respuesta.selection === 0;
        const resultado = responderSolicitudPvp(retado, retadorNombre, aceptar);
        if (resultado === 'caducada') {
            retado.sendMessage('§eEsta solicitud ya caducó.');
            return;
        }
        const retador = world.getPlayers().find((jugador) => jugador.name === retadorNombre);
        if (aceptar) {
            if (!retador || !iniciarPartidaArena(retador, retado)) {
                retado.sendMessage('§eNo se pudo iniciar el reto: la arena ya está ocupada o el retador se desconectó.');
                return;
            }
            retado.sendMessage(`§aAceptaste el reto de §f${retadorNombre}§a.`);
            retador.sendMessage(`§a${retado.name} aceptó tu reto de PvP.`);
        }
        else {
            retado.sendMessage(`§cRechazaste el reto de §f${retadorNombre}§c.`);
            retador?.sendMessage(`§c${retado.name} rechazó tu reto de PvP.`);
        }
    })
        .catch((error) => retado.sendMessage(`§cError al responder el reto: ${String(error)}`));
}
function abrirMenuTpa(player) {
    const solicitudes = obtenerSolicitudesTpa(player);
    new ActionFormData()
        .title('§b§lTPA')
        .body('§fEnvía o responde solicitudes de teletransporte.')
        .button('§bUnirse')
        .button('§aInvitar')
        .button(`§eSolicitudes (§f${solicitudes.length}§e)`)
        .button('Volver')
        .show(player)
        .then((respuesta) => {
        if (respuesta.canceled)
            return;
        if (respuesta.selection === 0)
            abrirListaTpa(player, 'unirse');
        if (respuesta.selection === 1)
            abrirListaTpa(player, 'invitar');
        if (respuesta.selection === 2)
            abrirSolicitudesTpa(player);
        if (respuesta.selection === 3)
            abrirMenuPrincipal(player);
    })
        .catch((error) => player.sendMessage(`§cError al abrir TPA: ${String(error)}`));
}
function abrirListaTpa(player, tipo) {
    const jugadores = world.getPlayers().filter((jugador) => jugador.name !== player.name);
    const esUnirse = tipo === 'unirse';
    const form = new ActionFormData()
        .title(esUnirse ? '§b§lTPA: Unirse' : '§a§lTPA: Invitar')
        .body(jugadores.length > 0
        ? esUnirse
            ? '§fElige a quién quieres unirte.'
            : '§fElige a quién quieres invitar hacia ti.'
        : '§fNo hay otros jugadores conectados.');
    for (const jugador of jugadores)
        form.button(`§f${jugador.name}`);
    form.button('Volver');
    form
        .show(player)
        .then((respuesta) => {
        if (respuesta.canceled || respuesta.selection === undefined)
            return;
        if (respuesta.selection === jugadores.length) {
            abrirMenuTpa(player);
            return;
        }
        const destinatario = jugadores[respuesta.selection];
        const destinatarioActual = destinatario && world.getPlayers().find((jugador) => jugador.name === destinatario.name);
        if (!destinatarioActual) {
            player.sendMessage('§cEse jugador ya no está conectado.');
            return;
        }
        if (!crearSolicitudTpa(player, destinatarioActual, tipo)) {
            player.sendMessage(`§eYa tienes una solicitud TPA activa para §f${destinatarioActual.name}§e.`);
            return;
        }
        const segundos = DURACION_SOLICITUD_TPA_MS / 1000;
        const accion = esUnirse ? 'unirte a' : 'invitar a';
        const descripcion = esUnirse
            ? `${player.name} §fquiere teletransportarse hacia ti.`
            : `${player.name} §fte invita a teletransportarte hacia él.`;
        player.sendMessage(`§aSolicitud enviada a §f${destinatarioActual.name}§a para ${accion}. Caduca en ${segundos} segundos.`);
        destinatarioActual.sendMessage(`§bSolicitud TPA: §f${descripcion} §eAbre TPA > Solicitudes para responder.`);
    })
        .catch((error) => player.sendMessage(`§cError al enviar TPA: ${String(error)}`));
}
function abrirSolicitudesTpa(player) {
    const solicitudes = obtenerSolicitudesTpa(player);
    const form = new ActionFormData()
        .title('§e§lSolicitudes TPA')
        .body(solicitudes.length > 0
        ? '§fSelecciona una solicitud para responder.'
        : '§fNo tienes solicitudes TPA activas.');
    for (const solicitud of solicitudes) {
        const texto = solicitud.tipo === 'unirse' ? 'quiere unirse' : 'te invita';
        form.button(`§f${solicitud.solicitante} §f(${texto})`);
    }
    form.button('Volver');
    form
        .show(player)
        .then((respuesta) => {
        if (respuesta.canceled || respuesta.selection === undefined)
            return;
        if (respuesta.selection === solicitudes.length) {
            abrirMenuTpa(player);
            return;
        }
        const solicitud = solicitudes[respuesta.selection];
        if (solicitud)
            abrirRespuestaSolicitudTpa(player, solicitud);
    })
        .catch((error) => player.sendMessage(`§cError al abrir solicitudes TPA: ${String(error)}`));
}
function abrirRespuestaSolicitudTpa(destinatario, solicitud) {
    const esUnirse = solicitud.tipo === 'unirse';
    const descripcion = esUnirse
        ? `§f${solicitud.solicitante} §fquiere teletransportarse hacia ti.`
        : `§f${solicitud.solicitante} §fte invita a teletransportarte hacia él.`;
    new ActionFormData()
        .title('§b§lSolicitud TPA')
        .body(descripcion)
        .button('§aAceptar')
        .button('§cRechazar')
        .button('Volver')
        .show(destinatario)
        .then((respuesta) => {
        if (respuesta.canceled)
            return;
        if (respuesta.selection === 2) {
            abrirSolicitudesTpa(destinatario);
            return;
        }
        const solicitudActual = responderSolicitudTpa(destinatario, solicitud.solicitante);
        if (!solicitudActual) {
            destinatario.sendMessage('§eEsta solicitud ya caducó.');
            return;
        }
        const solicitante = world
            .getPlayers()
            .find((jugador) => jugador.name === solicitudActual.solicitante);
        if (!solicitante) {
            destinatario.sendMessage('§eEl jugador ya no está conectado.');
            return;
        }
        if (respuesta.selection === 1) {
            destinatario.sendMessage(`§cRechazaste la solicitud de §f${solicitante.name}§c.`);
            solicitante.sendMessage(`§c${destinatario.name} rechazó tu solicitud TPA.`);
            return;
        }
        const jugadorATeletransportar = esUnirse ? solicitante : destinatario;
        const destino = esUnirse ? destinatario : solicitante;
        jugadorATeletransportar.teleport(destino.location, { dimension: destino.dimension });
        destinatario.sendMessage('§aSolicitud TPA aceptada.');
        solicitante.sendMessage('§aSolicitud TPA aceptada.');
    })
        .catch((error) => destinatario.sendMessage(`§cError al responder solicitud TPA: ${String(error)}`));
}
function abrirRanking(player) {
    const entradas = obtenerRankingCompleto();
    const lineas = entradas.map((entrada) => {
        const nombre = entrada.nombre === player.name ? `§e${entrada.nombre} §f(Tú)` : `§f${entrada.nombre}`;
        return `§6#${entrada.puesto}  ${nombre}  §b${entrada.puntos} pts`;
    });
    new ActionFormData()
        .title('§6§lRanking')
        .body(lineas.length > 0 ? lineas.join('\n') : '§fTodavía no hay registros de puntos.')
        .button('Volver')
        .show(player)
        .then((respuesta) => {
        if (!respuesta.canceled && respuesta.selection === 0)
            abrirMenuPrincipal(player);
    })
        .catch((error) => {
        player.sendMessage(`§cError al abrir ranking: ${String(error)}`);
    });
}
//# sourceMappingURL=menuPrincipal.js.map