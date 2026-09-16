import { system, world } from '@minecraft/server';
import { actualizarResumenRanking, asegurarJugadorEnRanking } from './ranking.js';
import { abrirMenuPrincipal } from './ui/menuPrincipal.js';
world.afterEvents.playerSpawn.subscribe((event) => {
    if (!event.initialSpawn)
        return;
    system.run(() => {
        asegurarJugadorEnRanking(event.player);
        actualizarResumenRanking(event.player);
    });
});
world.afterEvents.itemUse.subscribe((event) => {
    if (event.itemStack.typeId === 'minecraft:bread' && event.itemStack.nameTag === 'Form Opener') {
        system.run(() => abrirMenuPrincipal(event.source));
    }
});
//# sourceMappingURL=main.js.map