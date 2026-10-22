import { BlockPermutation, GameMode, ItemStack, system, world } from '@minecraft/server';
import '../features/combat/eliminaciones.js';
import { dispararEnergia, esTriggerGun } from '../features/combat/habilidades.js';
import { establecerCreativePlus, obtenerCreativePlus } from '../global/configuracion.js';
import { actualizarResumenRanking, asegurarJugadorEnRanking } from '../global/ranking.js';
import { abrirMenuPrincipal } from '../features/menu/menuPrincipal.js';
const TAG_OPERADOR = 'op';
function esOperador(player) {
    return player.hasTag(TAG_OPERADOR);
}
function puedeUsarCreativePlus(player) {
    return obtenerCreativePlus() && esOperador(player) && player.getGameMode() === GameMode.Creative;
}
function reemplazarBloqueEnSiguienteTick(block, dimension, itemStack) {
    let reemplazo;
    try {
        reemplazo = BlockPermutation.resolve(itemStack.typeId);
    }
    catch {
        return false;
    }
    const ubicacion = { ...block.location };
    system.run(() => {
        try {
            dimension.getBlock(ubicacion)?.setPermutation(reemplazo);
        }
        catch {
            // El bloque puede dejar de estar disponible si su chunk se descarga en este tick.
        }
    });
    return true;
}
world.afterEvents.playerSpawn.subscribe((event) => {
    if (!event.initialSpawn)
        return;
    system.run(() => {
        const esJugadorNuevo = asegurarJugadorEnRanking(event.player);
        if (esJugadorNuevo) {
            const sobrante = event.player
                .getComponent('minecraft:inventory')
                ?.container?.addItem(new ItemStack('spb:menu'));
            if (sobrante)
                event.player.dimension.spawnItem(sobrante, event.player.location);
        }
        actualizarResumenRanking(event.player);
    });
});
world.afterEvents.itemUse.subscribe((event) => {
    if (event.itemStack.typeId === 'spb:menu') {
        system.run(() => abrirMenuPrincipal(event.source));
        return;
    }
    if (esTriggerGun(event.itemStack.typeId, event.itemStack.nameTag)) {
        system.run(() => {
            try {
                dispararEnergia(event.source);
            }
            catch (error) {
                event.source.sendMessage(`§cNo se pudo disparar Gun: ${String(error)}`);
            }
        });
    }
});
world.beforeEvents.playerBreakBlock.subscribe((event) => {
    const { player, itemStack } = event;
    if (!puedeUsarCreativePlus(player) || !itemStack)
        return;
    if (reemplazarBloqueEnSiguienteTick(event.block, event.dimension, itemStack))
        event.cancel = true;
});
world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
    const { player, itemStack } = event;
    if (!event.isFirstEvent || !puedeUsarCreativePlus(player) || !itemStack)
        return;
    if (reemplazarBloqueEnSiguienteTick(event.block, event.block.dimension, itemStack)) {
        event.cancel = true;
    }
});
system.afterEvents.scriptEventReceive.subscribe((event) => {
    if (event.id !== 'spb:creativeplus')
        return;
    const origen = event.sourceEntity;
    if (!origen || origen.typeId !== 'minecraft:player')
        return;
    const player = origen;
    if (!esOperador(player)) {
        player.sendMessage('§cNo tienes permiso para usar este comando.');
        return;
    }
    const opcion = event.message.trim().toLowerCase() || 'estado';
    if (opcion === 'estado') {
        player.sendMessage(`§eCreative+ está ${obtenerCreativePlus() ? '§aactivado' : '§cdesactivado'}§e.`);
        return;
    }
    let nuevoEstado;
    if (opcion === 'on' || opcion === 'activar')
        nuevoEstado = true;
    else if (opcion === 'off' || opcion === 'desactivar')
        nuevoEstado = false;
    else if (opcion === 'toggle')
        nuevoEstado = !obtenerCreativePlus();
    else {
        player.sendMessage('§eUso: /scriptevent spb:creativeplus [on|off|toggle|estado]');
        return;
    }
    establecerCreativePlus(nuevoEstado);
    player.sendMessage(`§aCreative+ ${nuevoEstado ? 'activado' : 'desactivado'}§a.`);
}, { namespaces: ['spb'] });
//# sourceMappingURL=bootstrap.js.map