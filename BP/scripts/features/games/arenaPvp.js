import { BlockTypes, GameMode, InputPermissionCategory, ItemStack, system, world, } from '@minecraft/server';
import { ActionFormData } from '@minecraft/server-ui';
const DIMENSION_ARENA = 'minecraft:overworld';
const NOMBRE_TICKING_AREA_ARENA = 'spb_arena';
const ESPERA_ENTRE_RONDAS_TICKS = 20 * 5;
const PUNTOS_PARA_GANAR = 3;
const NPC_ARENA = { x: -10, y: 183, z: -1933 };
const POSICION_P1 = { x: 20, y: 180, z: -1933 };
const POSICION_P2 = { x: -40, y: 180, z: -1933 };
const AREA_SEGURA = {
    min: { x: -48, y: 176, z: -1945 },
    max: { x: 29, y: 204, z: -1921 },
};
// Porterías con exactamente los mismos límites de los comandos del mapa.
const PORTERIA_P2 = {
    min: { x: -38, y: 177, z: -1934 },
    max: { x: -36, y: 177, z: -1934 },
};
const PORTERIA_P1 = {
    min: { x: 16, y: 177, z: -1934 },
    max: { x: 18, y: 177, z: -1934 },
};
let partida;
let npcId;
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
        player.teleport(posicionInicial(player), { dimension: dimensionArena() });
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
        const secciones = [
            { minY: AREA_SEGURA.min.y, maxY: 189 },
            { minY: 190, maxY: AREA_SEGURA.max.y },
        ];
        for (const seccion of secciones) {
            const limites = `${AREA_SEGURA.min.x} ${seccion.minY} ${AREA_SEGURA.min.z} ${AREA_SEGURA.max.x} ${seccion.maxY} ${AREA_SEGURA.max.z}`;
            dimension.runCommand(`fill ${limites} air replace spb:bloque_verde`);
            dimension.runCommand(`fill ${limites} air replace spb:bloque_rojo`);
        }
    }
    catch {
        // La limpieza se intentará de nuevo al cerrar una futura partida si un chunk no estaba disponible.
    }
}
function esNpcArena(entidad) {
    if (entidad.typeId !== 'minecraft:npc')
        return false;
    if (entidad.id === npcId)
        return true;
    return (Math.abs(entidad.location.x - NPC_ARENA.x) < 1 &&
        Math.abs(entidad.location.y - NPC_ARENA.y) < 1 &&
        Math.abs(entidad.location.z - NPC_ARENA.z) < 1);
}
function asegurarNpc() {
    if (partida?.fase === 'jugando' || partida?.fase === 'esperando')
        return;
    asegurarChunksArena();
    try {
        const existente = dimensionArena().getEntities({ type: 'minecraft:npc', location: NPC_ARENA, maxDistance: 4 })[0];
        const npc = existente ?? dimensionArena().spawnEntity('minecraft:npc', NPC_ARENA);
        npc.nameTag = '§b§lArena PvP';
        npcId = npc.id;
    }
    catch {
        // La ticking area puede tardar unos ticks en activarse al abrir el mundo.
        // Reintentamos sin dejar que el error cancele la aceptación del reto.
        if (reintentoNpcPendiente)
            return;
        reintentoNpcPendiente = true;
        system.runTimeout(() => {
            reintentoNpcPendiente = false;
            asegurarNpc();
        }, 10);
    }
}
function quitarNpc() {
    const npcs = dimensionArena().getEntities({ type: 'minecraft:npc', location: NPC_ARENA, maxDistance: 4 });
    for (const npc of npcs) {
        try {
            npc.remove();
        }
        catch {
            // Ya fue eliminado.
        }
    }
    npcId = undefined;
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
function enviarASpawn(player) {
    congelar(player, false);
    eliminarBloquesDeJugador(player);
    let cama;
    try {
        cama = player.getSpawnPoint();
    }
    catch {
        cama = undefined;
    }
    if (cama) {
        try {
            player.teleport(cama, { dimension: cama.dimension });
            return;
        }
        catch {
            // Una cama eliminada, obstruida o descargada debe usar el spawn mundial.
        }
    }
    try {
        player.teleport(obtenerSpawnMundialSeguro(), { dimension: dimensionArena() });
    }
    catch {
        player.sendMessage('§cNo se pudo encontrar un punto de reaparición seguro.');
    }
}
function cancelarPartida(motivo, jugadorQueQueda) {
    const actual = partida;
    if (!actual)
        return;
    partida = undefined;
    limpiarCampo();
    quitarNpc();
    if (jugadorQueQueda) {
        enviarASpawn(jugadorQueQueda);
        jugadorQueQueda.sendMessage(`§eLa partida fue cancelada: ${motivo}`);
    }
}
function finalizarPorVictoria(ganador) {
    const actual = partida;
    if (!actual)
        return;
    const p1 = jugadorPorId(actual.p1Id);
    const p2 = jugadorPorId(actual.p2Id);
    if (p1) {
        teletransportarInicio(p1, false);
        eliminarBloquesDeJugador(p1);
    }
    if (p2) {
        teletransportarInicio(p2, false);
        eliminarBloquesDeJugador(p2);
    }
    limpiarCampo();
    actual.fase = 'lobby';
    actual.puntosP1 = 0;
    actual.puntosP2 = 0;
    actual.version += 1;
    ganador.sendMessage('§6§l¡Ganaste la partida! §eEl NPC está disponible para jugar de nuevo o salir.');
    const perdedor = ganador.id === actual.p1Id ? p2 : p1;
    perdedor?.sendMessage(`§c${ganador.name} ganó la partida. §eUsen el NPC para decidir qué hacer.`);
    asegurarNpc();
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
        .body('§7Ambos jugadores deben estar listos.')
        .button('§aJugar')
        .button('§cSalir')
        .show(player)
        .then((respuesta) => {
        if (respuesta.canceled || respuesta.selection === undefined || !partida || !esParticipante(player))
            return;
        if (respuesta.selection === 0) {
            limpiarCampo();
            quitarNpc();
            prepararRonda();
            return;
        }
        if (respuesta.selection === 1) {
            const p1 = jugadorPorId(partida.p1Id);
            const p2 = jugadorPorId(partida.p2Id);
            partida = undefined;
            limpiarCampo();
            quitarNpc();
            if (p1)
                enviarASpawn(p1);
            if (p2)
                enviarASpawn(p2);
        }
    })
        .catch(() => undefined);
}
/** Inicia la sesión de arena inmediatamente después de aceptar una solicitud PvP. */
export function iniciarPartidaArena(retador, retado) {
    if (partida)
        return false;
    partida = {
        p1Id: retador.id,
        p2Id: retado.id,
        p1Nombre: retador.name,
        p2Nombre: retado.name,
        puntosP1: 0,
        puntosP2: 0,
        fase: 'lobby',
        version: 0,
    };
    retador.setGameMode(GameMode.Survival);
    retado.setGameMode(GameMode.Survival);
    teletransportarInicio(retador, false);
    teletransportarInicio(retado, false);
    retador.sendMessage('§bPartida creada. Acérquense al NPC y pulsen §aJugar§b cuando estén listos.');
    retado.sendMessage('§bPartida creada. Acérquense al NPC y pulsen §aJugar§b cuando estén listos.');
    asegurarNpc();
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
    if (!esNpcArena(event.target))
        return;
    event.cancel = true;
    system.run(() => abrirMenuNpc(event.player));
});
// Protege la construcción original de la arena, pero permite retirar los
// bloques rojo y verde que los participantes hayan colocado durante una ronda.
world.beforeEvents.playerBreakBlock.subscribe((event) => {
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
    if (event.dimension.id !== DIMENSION_ARENA)
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
            teletransportarInicio(event.player, false);
            event.player.sendMessage('§eReapareciste en tu posición inicial.');
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
            teletransportarInicio(player, partida.fase === 'esperando');
            player.sendMessage('§cSaliste del área segura y fuiste devuelto a tu posición inicial.');
            continue;
        }
        if (partida.fase !== 'jugando')
            continue;
        if (esP1(player)) {
            if (jugadorTocaAreaDeBloques(player, PORTERIA_P2))
                anotar(player);
            else if (jugadorTocaAreaDeBloques(player, PORTERIA_P1)) {
                teletransportarInicio(player, false);
                player.sendMessage('§eEntraste en tu propia portería y regresaste a tu posición inicial.');
            }
        }
        else if (jugadorTocaAreaDeBloques(player, PORTERIA_P1))
            anotar(player);
        else if (jugadorTocaAreaDeBloques(player, PORTERIA_P2)) {
            teletransportarInicio(player, false);
            player.sendMessage('§eEntraste en tu propia portería y regresaste a tu posición inicial.');
        }
    }
}, 1);
// Una recarga del paquete no conserva una partida en memoria. Liberamos cualquier
// bloqueo de movimiento que pudiera haber quedado de una sesión anterior.
system.run(() => {
    asegurarChunksArena();
    for (const player of world.getPlayers())
        congelar(player, false);
    system.runTimeout(asegurarNpc, 10);
});
//# sourceMappingURL=arenaPvp.js.map