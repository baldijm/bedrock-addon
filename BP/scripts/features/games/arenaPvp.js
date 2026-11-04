import { BlockTypes, GameMode, InputPermissionCategory, ItemStack, system, world, } from '@minecraft/server';
import { ActionFormData } from '@minecraft/server-ui';
import { obtenerPvpActivo } from '../../global/configuracion.js';
import { arenaState, arenaChanging, installArenaControl } from './arenaControl.js';
import { legacyArena } from './arenaSchema.js';
let DIMENSION_ARENA = 'minecraft:overworld';
const NOMBRE_TICKING_AREA_ARENA = 'spb_arena';
const ESPERA_ENTRE_RONDAS_TICKS = 20 * 5;
const PUNTOS_PARA_GANAR = 3;
let NPC_ARENA_P1 = legacyArena.npc1;
let NPC_ARENA_P2 = legacyArena.npc2;
let POSICION_P1 = legacyArena.p1;
let POSICION_P2 = legacyArena.p2;
let POSICION_RETORNO_ARENA = legacyArena.returnPoint;
let YAW_P1 = legacyArena.yaw1;
let YAW_P2 = legacyArena.yaw2;
let AREA_SEGURA = {
    min: { x: -515, y: 199, z: 104 },
    max: { x: -485, y: 320, z: 197 },
};
// Porterías con exactamente los mismos límites de los comandos del mapa.
let PORTERIA_P2 = {
    min: { x: -501, y: 201, z: 179 },
    max: { x: -499, y: 203, z: 182 },
};
let PORTERIA_P1 = {
    min: { x: -501, y: 201, z: 120 },
    max: { x: -499, y: 203, z: 122 },
};
let partida;
let npcIds = {};
let reintentoNpcPendiente = false;
const jugadoresQueReaparecenEnArena = new Set();
function dimensionArena() {
    return world.getDimension(DIMENSION_ARENA);
}
/** Mantiene cargados los chunks de toda la arena aunque nadie esté cerca. */
function asegurarChunksArena() {
    const dimension = dimensionArena();
    try {
        dimension.runCommand(`tickingarea add ${AREA_SEGURA.min.x} ${AREA_SEGURA.min.y} ${AREA_SEGURA.min.z} ${AREA_SEGURA.max.x} ${AREA_SEGURA.max.y} ${AREA_SEGURA.max.z} ${NOMBRE_TICKING_AREA_ARENA} true`);
        return true;
    }
    catch {
        // Si ya existe, el comando add falla; activamos su precarga en su lugar.
        try {
            dimension.runCommand(`tickingarea preload ${NOMBRE_TICKING_AREA_ARENA} true`);
            return true;
        }
        catch {
            return false;
        }
    }
}
function jugadorPorId(id) {
    return world.getPlayers().find((jugador) => jugador.id === id);
}
function estaDentro(ubicacion, area) {
    return (ubicacion.x >= area.min.x && ubicacion.x <= area.max.x &&
        ubicacion.y >= area.min.y && ubicacion.y <= area.max.y &&
        ubicacion.z >= area.min.z && ubicacion.z <= area.max.z);
}
function jugadorTocaAreaDeBloques(player, area) {
    const ubicacion = player.location;
    const radio = 0.3;
    const altura = 1.8;
    return (ubicacion.x + radio > area.min.x &&
        ubicacion.x - radio < area.max.x + 1 &&
        ubicacion.y + altura > area.min.y &&
        ubicacion.y < area.max.y + 1 &&
        ubicacion.z + radio > area.min.z &&
        ubicacion.z - radio < area.max.z + 1);
}
function esParticipante(player) {
    return partida?.p1Id === player.id || partida?.p2Id === player.id;
}
function esP1(player) {
    return partida?.p1Id === player.id;
}
/** El dueño puede intervenir temporalmente sin que la arena lo limite. */
function tieneExcepcionAdministrativa(player) {
    return player.hasTag('op') && player.getGameMode() === GameMode.Creative;
}
function posicionInicial(player) {
    return esP1(player) ? POSICION_P1 : POSICION_P2;
}
function congelar(player, congelado) {
    try {
        player.inputPermissions.setPermissionCategory(InputPermissionCategory.Movement, !congelado);
    }
    catch {
        // El jugador pudo desconectarse entre la comprobación y esta acción.
    }
}
function teletransportarInicio(player, congelado) {
    try {
        const position = posicionInicial(player);
        player.teleport({ ...position, x: position.x + 0.5, z: position.z + 0.5 }, { dimension: dimensionArena() });
        congelar(player, congelado);
    }
    catch {
        // Se recuperará cuando vuelva a conectarse o se cancelará la partida.
    }
}
function eliminarBloquesDeJugador(player) {
    const inventario = player.getComponent('minecraft:inventory')?.container;
    if (!inventario)
        return;
    for (let indice = 0; indice < inventario.size; indice += 1) {
        const item = inventario.getItem(indice);
        if (item?.typeId === 'spb:bloque_verde' || item?.typeId === 'spb:bloque_rojo') {
            inventario.setItem(indice, undefined);
        }
    }
}
function entregarBloques(player) {
    try {
        eliminarBloquesDeJugador(player);
        const inventario = player.getComponent('minecraft:inventory')?.container;
        if (!inventario)
            return;
        const bloque = esP1(player) ? 'spb:bloque_verde' : 'spb:bloque_rojo';
        const sobrante = inventario.addItem(new ItemStack(bloque, 64));
        if (sobrante)
            player.dimension.spawnItem(sobrante, player.location);
    }
    catch (error) {
        player.sendMessage(`§cNo se pudieron entregar los bloques de la arena: ${String(error)}`);
    }
}
function limpiarCampo() {
    try {
        const dimension = dimensionArena();
        const footprint = (AREA_SEGURA.max.x - AREA_SEGURA.min.x + 1) * (AREA_SEGURA.max.z - AREA_SEGURA.min.z + 1);
        const height = Math.max(1, Math.floor(32768 / footprint));
        for (let y = AREA_SEGURA.min.y; y <= AREA_SEGURA.max.y; y += height) {
            const limites = `${AREA_SEGURA.min.x} ${y} ${AREA_SEGURA.min.z} ${AREA_SEGURA.max.x} ${Math.min(y + height - 1, AREA_SEGURA.max.y)} ${AREA_SEGURA.max.z}`;
            dimension.runCommand(`fill ${limites} air replace spb:bloque_verde`);
            dimension.runCommand(`fill ${limites} air replace spb:bloque_rojo`);
        }
    }
    catch {
        // La limpieza se intentará de nuevo al cerrar una futura partida si un chunk no estaba disponible.
    }
}
function obtenerRolNpc(entidad) {
    if (!partida || entidad.typeId !== 'minecraft:npc' || entidad.dimension.id !== DIMENSION_ARENA)
        return undefined;
    if (entidad.id === npcIds.p1)
        return 'p1';
    if (entidad.id === npcIds.p2)
        return 'p2';
    if (Math.abs(entidad.location.x - NPC_ARENA_P1.x) < 1 &&
        Math.abs(entidad.location.y - NPC_ARENA_P1.y) < 1 &&
        Math.abs(entidad.location.z - NPC_ARENA_P1.z) < 1)
        return 'p1';
    if (Math.abs(entidad.location.x - NPC_ARENA_P2.x) < 1 &&
        Math.abs(entidad.location.y - NPC_ARENA_P2.y) < 1 &&
        Math.abs(entidad.location.z - NPC_ARENA_P2.z) < 1)
        return 'p2';
    return undefined;
}
function asegurarNpcEn(posicion, nombre, id, yaw) {
    const role = posicion === NPC_ARENA_P1 ? 'p1' : 'p2';
    const tag = `spb:pvp_${role}`;
    const dimension = dimensionArena();
    const tagged = dimension.getEntities({ type: 'minecraft:npc', tags: [tag] });
    for (const item of tagged) {
        if (Math.hypot(item.location.x - posicion.x, item.location.y - posicion.y, item.location.z - posicion.z) > 2)
            item.remove();
    }
    const existente = dimension.getEntities({ type: 'minecraft:npc', tags: [tag], location: posicion, maxDistance: 2 })[0];
    const npc = existente ?? dimensionArena().spawnEntity('minecraft:npc', { ...posicion, x: posicion.x + 0.5, z: posicion.z + 0.5 });
    npc.addTag(tag);
    npc.setRotation({ x: 0, y: yaw });
    npc.nameTag = nombre;
    return npc.id ?? id;
}
function asegurarNpcs() {
    if (partida?.fase !== 'lobby')
        return;
    try {
        comprobarSuelo(arenaState().active);
    }
    catch {
        cancelarPartida('faltan suelo o espacio seguros en la arena');
        return;
    }
    asegurarChunksArena();
    try {
        npcIds = {
            p1: asegurarNpcEn(NPC_ARENA_P1, '§b§lArena PvP §f(Jugador 1)', npcIds.p1, YAW_P1),
            p2: asegurarNpcEn(NPC_ARENA_P2, '§b§lArena PvP §f(Jugador 2)', npcIds.p2, YAW_P2),
        };
    }
    catch {
        // La ticking area puede tardar unos ticks en activarse al abrir el mundo.
        // Reintentamos sin dejar que el error cancele la aceptación del reto.
        if (reintentoNpcPendiente)
            return;
        reintentoNpcPendiente = true;
        system.runTimeout(() => {
            reintentoNpcPendiente = false;
            asegurarNpcs();
        }, 10);
    }
}
function quitarNpcs() {
    const npcs = [
        ...dimensionArena().getEntities({ type: 'minecraft:npc', tags: ['spb:pvp_p1'] }),
        ...dimensionArena().getEntities({ type: 'minecraft:npc', tags: ['spb:pvp_p2'] }),
    ];
    for (const npc of npcs) {
        try {
            npc.remove();
        }
        catch {
            // Ya fue eliminado.
        }
    }
    npcIds = {};
}
/** Reproduce la búsqueda de suelo que Minecraft hace si el spawn mundial usa Y=32767. */
function obtenerSpawnMundialSeguro() {
    const spawn = world.getDefaultSpawnLocation();
    const dimension = dimensionArena();
    const limites = dimension.heightRange;
    if (spawn.y >= limites.min && spawn.y <= limites.max)
        return spawn;
    const x = Math.floor(spawn.x);
    const z = Math.floor(spawn.z);
    for (let y = limites.max - 1; y >= limites.min; y -= 1) {
        const suelo = dimension.getBlock({ x, y, z });
        const espacioCabeza = dimension.getBlock({ x, y: y + 1, z });
        const espacioSobreCabeza = dimension.getBlock({ x, y: y + 2, z });
        if (suelo && !suelo.isAir && !suelo.isLiquid &&
            espacioCabeza?.isAir &&
            espacioSobreCabeza?.isAir) {
            return { x: x + 0.5, y: y + 1, z: z + 0.5 };
        }
    }
    // Un mundo vacío no tiene una ubicación segura que encontrar. Evitamos la altura centinela.
    return { x: spawn.x, y: limites.max - 1, z: spawn.z };
}
function guardarEstadoOriginal(player) {
    return {
        location: { ...player.location },
        dimensionId: player.dimension.id,
        gameMode: player.getGameMode(),
    };
}
function restaurarEstadoOriginal(player, estado) {
    congelar(player, false);
    eliminarBloquesDeJugador(player);
    try {
        player.teleport(estado.location, { dimension: world.getDimension(estado.dimensionId), checkForBlocks: false });
        player.setGameMode(estado.gameMode);
    }
    catch {
        player.sendMessage('§cNo se pudo regresar a tu ubicación anterior.');
    }
}
function regresarAlCentro(player, congelado) {
    try {
        player.teleport({ ...POSICION_RETORNO_ARENA, x: POSICION_RETORNO_ARENA.x + 0.5, z: POSICION_RETORNO_ARENA.z + 0.5 }, { dimension: dimensionArena(), checkForBlocks: true });
        congelar(player, congelado);
    }
    catch {
        // El siguiente ciclo de la arena volverá a intentar el retorno.
    }
}
function cancelarPartida(motivo, jugadorQueQueda) {
    const actual = partida;
    if (!actual)
        return;
    partida = undefined;
    limpiarCampo();
    quitarNpcs();
    for (const [id, estado] of [[actual.p1Id, actual.originalP1], [actual.p2Id, actual.originalP2]]) {
        const jugador = jugadorPorId(id);
        if (jugador) {
            restaurarEstadoOriginal(jugador, estado);
            jugador.sendMessage(`§eLa partida fue cancelada: ${motivo}`);
        }
    }
    asegurarNpcs();
}
function finalizarPorVictoria(ganador) {
    const actual = partida;
    if (!actual)
        return;
    const p1 = jugadorPorId(actual.p1Id);
    const p2 = jugadorPorId(actual.p2Id);
    if (p1)
        restaurarEstadoOriginal(p1, actual.originalP1);
    if (p2)
        restaurarEstadoOriginal(p2, actual.originalP2);
    limpiarCampo();
    partida = undefined;
    quitarNpcs();
    ganador.sendMessage('§6§l¡Ganaste la partida! §eAmbos regresaron a su ubicación anterior.');
    const perdedor = ganador.id === actual.p1Id ? p2 : p1;
    perdedor?.sendMessage(`§c${ganador.name} ganó la partida.`);
    asegurarNpcs();
}
function anotar(goleador) {
    const actual = partida;
    if (!actual || actual.fase !== 'jugando')
        return;
    if (esP1(goleador))
        actual.puntosP1 += 1;
    else
        actual.puntosP2 += 1;
    const p1 = jugadorPorId(actual.p1Id);
    const p2 = jugadorPorId(actual.p2Id);
    const marcador = `§a${actual.p1Nombre} §f${actual.puntosP1} §7- §f${actual.puntosP2} §c${actual.p2Nombre}`;
    p1?.sendMessage(`§6¡Punto de ${goleador.name}! ${marcador}`);
    p2?.sendMessage(`§6¡Punto de ${goleador.name}! ${marcador}`);
    if (actual.puntosP1 >= PUNTOS_PARA_GANAR || actual.puntosP2 >= PUNTOS_PARA_GANAR) {
        finalizarPorVictoria(goleador);
        return;
    }
    prepararRonda();
}
function iniciarRonda(version) {
    if (!partida || partida.version !== version || partida.fase !== 'esperando')
        return;
    const p1 = jugadorPorId(partida.p1Id);
    const p2 = jugadorPorId(partida.p2Id);
    if (!p1 || !p2) {
        cancelarPartida('un participante se desconectó', p1 ?? p2);
        return;
    }
    congelar(p1, false);
    congelar(p2, false);
    partida.fase = 'jugando';
    p1.sendMessage('§a§l¡Ronda iniciada!');
    p2.sendMessage('§a§l¡Ronda iniciada!');
}
function prepararRonda() {
    const actual = partida;
    if (!actual)
        return;
    const p1 = jugadorPorId(actual.p1Id);
    const p2 = jugadorPorId(actual.p2Id);
    if (!p1 || !p2) {
        cancelarPartida('un participante se desconectó', p1 ?? p2);
        return;
    }
    actual.fase = 'esperando';
    actual.version += 1;
    const version = actual.version;
    teletransportarInicio(p1, true);
    teletransportarInicio(p2, true);
    // La entrega no puede impedir que se programe el desbloqueo de la ronda.
    entregarBloques(p1);
    entregarBloques(p2);
    p1.sendMessage('§eSiguiente ronda en 5 segundos.');
    p2.sendMessage('§eSiguiente ronda en 5 segundos.');
    system.runTimeout(() => iniciarRonda(version), ESPERA_ENTRE_RONDAS_TICKS);
}
function abrirMenuNpc(player) {
    if (!partida || !esParticipante(player) || partida.fase !== 'lobby') {
        player.sendMessage('§eEste NPC solo está disponible para los dos jugadores de la partida.');
        return;
    }
    new ActionFormData()
        .title('§b§lArena PvP')
        .body(`§7Tu estado: ${esP1(player) ? (partida.listoP1 ? '§aListo' : '§eNo listo') : (partida.listoP2 ? '§aListo' : '§eNo listo')}\n§7El rival debe confirmar en su propio NPC.`)
        .button(esP1(player) && partida.listoP1 || !esP1(player) && partida.listoP2 ? '§eQuitar listo' : '§aEstoy listo')
        .button('§cSalir')
        .show(player)
        .then((respuesta) => {
        if (respuesta.canceled || respuesta.selection === undefined || !partida || !esParticipante(player))
            return;
        if (respuesta.selection === 0) {
            if (esP1(player))
                partida.listoP1 = !partida.listoP1;
            else
                partida.listoP2 = !partida.listoP2;
            const rival = jugadorPorId(esP1(player) ? partida.p2Id : partida.p1Id);
            player.sendMessage(esP1(player) && partida.listoP1 || !esP1(player) && partida.listoP2
                ? '§aMarcado como listo. Esperando al otro jugador.'
                : '§eYa no estás listo.');
            rival?.sendMessage(`§e${player.name} ${esP1(player) && partida.listoP1 || !esP1(player) && partida.listoP2 ? 'ya está listo' : 'quitó su estado de listo'}.`);
            if (partida.listoP1 && partida.listoP2) {
                limpiarCampo();
                quitarNpcs();
                prepararRonda();
            }
            return;
        }
        if (respuesta.selection === 1) {
            const p1 = jugadorPorId(partida.p1Id);
            const p2 = jugadorPorId(partida.p2Id);
            const actual = partida;
            partida = undefined;
            limpiarCampo();
            quitarNpcs();
            if (p1)
                restaurarEstadoOriginal(p1, actual.originalP1);
            if (p2)
                restaurarEstadoOriginal(p2, actual.originalP2);
            p1?.sendMessage('§eSaliste de la partida PvP.');
            p2?.sendMessage(`§e${player.name} salió de la partida PvP.`);
            asegurarNpcs();
        }
    })
        .catch(() => undefined);
}
/** Inicia la sesión de arena inmediatamente después de aceptar una solicitud PvP. */
export function iniciarPartidaArena(retador, retado) {
    if (!obtenerPvpActivo() || partida || arenaChanging())
        return false;
    const active = arenaState().active;
    if (!active) {
        retador.sendMessage('§eNo hay una arena PvP activada desde el dashboard.');
        retado.sendMessage('§eNo hay una arena PvP activada desde el dashboard.');
        return false;
    }
    try {
        comprobarSuelo(active);
    }
    catch (error) {
        retador.sendMessage(`§cArena no disponible: ${String(error)}`);
        retado.sendMessage(`§cArena no disponible: ${String(error)}`);
        return false;
    }
    partida = {
        p1Id: retador.id,
        p2Id: retado.id,
        p1Nombre: retador.name,
        p2Nombre: retado.name,
        puntosP1: 0,
        puntosP2: 0,
        fase: 'lobby',
        version: 0,
        listoP1: false,
        listoP2: false,
        originalP1: guardarEstadoOriginal(retador),
        originalP2: guardarEstadoOriginal(retado),
    };
    retador.setGameMode(GameMode.Survival);
    retado.setGameMode(GameMode.Survival);
    teletransportarInicio(retador, false);
    teletransportarInicio(retado, false);
    retador.sendMessage('§bPartida creada. Acérquense al NPC y pulsen §aJugar§b cuando estén listos.');
    retado.sendMessage('§bPartida creada. Acérquense al NPC y pulsen §aJugar§b cuando estén listos.');
    asegurarNpcs();
    return true;
}
export function hayPartidaArenaActiva() {
    return partida !== undefined;
}
/** Devuelve los puntos especiales solo para una eliminación entre participantes de la arena. */
export function obtenerPuntosPorEliminacionArena(atacante, victima) {
    if (!partida || partida.fase !== 'jugando')
        return undefined;
    if (!esParticipante(atacante) || !esParticipante(victima) || atacante.id === victima.id)
        return undefined;
    return 50;
}
world.beforeEvents.playerInteractWithEntity.subscribe((event) => {
    const rol = obtenerRolNpc(event.target);
    if (!rol)
        return;
    event.cancel = true;
    system.run(() => {
        if (!partida || (rol === 'p1' ? partida.p1Id : partida.p2Id) === event.player.id) {
            abrirMenuNpc(event.player);
            return;
        }
        event.player.sendMessage('§eEste es el NPC del otro jugador. Usa el que está en tu lado de la arena.');
    });
});
// Protege la construcción original de la arena, pero permite retirar los
// bloques rojo y verde que los participantes hayan colocado durante una ronda.
world.beforeEvents.playerBreakBlock.subscribe((event) => {
    if (!arenaState().active || event.dimension.id !== DIMENSION_ARENA)
        return;
    if (!estaDentro(event.block.location, AREA_SEGURA))
        return;
    if (event.player.hasTag('op') && event.player.getGameMode() === GameMode.Creative)
        return;
    const id = event.block.typeId;
    if (id !== 'spb:bloque_verde' && id !== 'spb:bloque_rojo')
        event.cancel = true;
});
world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
    if (!partida || !esParticipante(event.player) || !event.itemStack)
        return;
    if (tieneExcepcionAdministrativa(event.player))
        return;
    if (!estaDentro(event.block.location, AREA_SEGURA))
        return;
    if (!BlockTypes.get(event.itemStack.typeId))
        return;
    if (event.itemStack.typeId === 'spb:bloque_verde' || event.itemStack.typeId === 'spb:bloque_rojo')
        return;
    event.cancel = true;
});
world.beforeEvents.explosion.subscribe((event) => {
    if (!arenaState().active || event.dimension.id !== DIMENSION_ARENA)
        return;
    event.setImpactedBlocks(event.getImpactedBlocks().filter((block) => {
        if (!estaDentro(block.location, AREA_SEGURA))
            return true;
        return block.typeId === 'spb:bloque_verde' || block.typeId === 'spb:bloque_rojo';
    }));
});
world.afterEvents.entityDie.subscribe((event) => {
    if (event.deadEntity.typeId !== 'minecraft:player' || !partida)
        return;
    const victima = event.deadEntity;
    if (!esParticipante(victima) || partida.fase !== 'jugando')
        return;
    jugadoresQueReaparecenEnArena.add(victima.id);
});
world.afterEvents.playerSpawn.subscribe((event) => {
    if (event.initialSpawn || !partida || !jugadoresQueReaparecenEnArena.delete(event.player.id))
        return;
    if (!esParticipante(event.player) || partida.fase !== 'jugando')
        return;
    system.run(() => {
        if (partida && esParticipante(event.player) && partida.fase === 'jugando') {
            regresarAlCentro(event.player, false);
            event.player.sendMessage('§eReapareciste en el centro de la arena.');
        }
    });
});
world.afterEvents.playerLeave.subscribe((event) => {
    if (!partida || (event.playerId !== partida.p1Id && event.playerId !== partida.p2Id))
        return;
    const restante = jugadorPorId(event.playerId === partida.p1Id ? partida.p2Id : partida.p1Id);
    cancelarPartida(`${event.playerName} se desconectó`, restante);
});
system.runInterval(() => {
    if (!partida)
        return;
    const p1 = jugadorPorId(partida.p1Id);
    const p2 = jugadorPorId(partida.p2Id);
    if (!p1 || !p2) {
        cancelarPartida('un participante se desconectó', p1 ?? p2);
        return;
    }
    for (const player of [p1, p2]) {
        // Un admin con op en creativo puede intervenir libremente. Al volver a
        // supervivencia, este bypass deja de aplicar de inmediato.
        if (tieneExcepcionAdministrativa(player)) {
            congelar(player, false);
            continue;
        }
        if (player.dimension.id !== DIMENSION_ARENA || !estaDentro(player.location, AREA_SEGURA)) {
            regresarAlCentro(player, partida.fase === 'esperando');
            player.sendMessage('§cSaliste del área segura y fuiste devuelto al centro de la arena.');
            continue;
        }
        if (partida.fase !== 'jugando')
            continue;
        if (esP1(player)) {
            if (jugadorTocaAreaDeBloques(player, PORTERIA_P2))
                anotar(player);
            else if (jugadorTocaAreaDeBloques(player, PORTERIA_P1)) {
                regresarAlCentro(player, false);
                player.sendMessage('§eEntraste en tu propia portería y regresaste al centro de la arena.');
            }
        }
        else if (jugadorTocaAreaDeBloques(player, PORTERIA_P1))
            anotar(player);
        else if (jugadorTocaAreaDeBloques(player, PORTERIA_P2)) {
            regresarAlCentro(player, false);
            player.sendMessage('§eEntraste en tu propia portería y regresaste al centro de la arena.');
        }
    }
}, 1);
function comprobarSuelo(arena) {
    const dimension = world.getDimension(arena.dimension);
    for (const [label, position] of Object.entries({ P1: arena.p1, P2: arena.p2, Retorno: arena.returnPoint, NPC1: arena.npc1, NPC2: arena.npc2 })) {
        const floor = dimension.getBlock({ x: position.x, y: position.y - 1, z: position.z });
        const feet = dimension.getBlock(position);
        const head = dimension.getBlock({ ...position, y: position.y + 1 });
        const support = dimension.getBlockFromRay({ x: position.x + 0.5, y: position.y + 0.1, z: position.z + 0.5 }, { x: 0, y: -1, z: 0 }, { maxDistance: 1.2, includePassableBlocks: false, includeLiquidBlocks: false });
        if (!floor || floor.isAir || floor.isLiquid || support?.block.location.y !== position.y - 1 || !feet?.isAir || !head?.isAir)
            throw new Error(`${label}: falta suelo sólido o espacio libre en ${position.x}, ${position.y}, ${position.z}.`);
    }
}
function usarArena(arena) {
    try {
        quitarNpcs();
    }
    catch { /* Los chunks anteriores pueden estar descargados. */ }
    try {
        dimensionArena().runCommand(`tickingarea remove ${NOMBRE_TICKING_AREA_ARENA}`);
    }
    catch { /* No existía. */ }
    if (!arena)
        return;
    DIMENSION_ARENA = arena.dimension;
    NPC_ARENA_P1 = arena.npc1;
    NPC_ARENA_P2 = arena.npc2;
    POSICION_P1 = arena.p1;
    POSICION_P2 = arena.p2;
    POSICION_RETORNO_ARENA = arena.returnPoint;
    AREA_SEGURA = arena.bounds;
    PORTERIA_P1 = arena.goal1;
    PORTERIA_P2 = arena.goal2;
    YAW_P1 = arena.yaw1;
    YAW_P2 = arena.yaw2;
    asegurarChunksArena();
}
installArenaControl({
    busy: () => !!partida,
    apply: usarArena,
    prepare: async (arena) => {
        const dimension = world.getDimension(arena.dimension);
        const { min, max } = arena.bounds;
        const temporary = 'spb_pvp_check';
        try {
            dimension.runCommand(`tickingarea add ${min.x} ${min.y} ${min.z} ${max.x} ${max.y} ${max.z} ${temporary} true`);
            await system.waitTicks(40);
            comprobarSuelo(arena);
        }
        finally {
            try {
                dimension.runCommand(`tickingarea remove ${temporary}`);
            }
            catch { /* Ya no existe. */ }
        }
    },
});
system.runInterval(asegurarNpcs, 20);
// Una recarga del paquete no conserva una partida en memoria. Liberamos cualquier
// bloqueo de movimiento que pudiera haber quedado de una sesión anterior.
system.run(() => {
    usarArena(arenaState().active);
    for (const player of world.getPlayers())
        congelar(player, false);
});
//# sourceMappingURL=arenaPvp.js.map