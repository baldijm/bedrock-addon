import { system, world } from '@minecraft/server';
const DISTANCIA_MINIMA = 300;
const DISTANCIA_MAXIMA = 2500;
const MAX_INTENTOS = 6;
const MAX_ESPERA_TICKS = 40;
const TELETRANSPORTES_EN_CURSO = new Set();
const BLOQUES_PELIGROSOS = new Set([
    'minecraft:cactus',
    'minecraft:campfire',
    'minecraft:fire',
    'minecraft:magma',
    'minecraft:pointed_dripstone',
    'minecraft:powder_snow',
    'minecraft:soul_campfire',
    'minecraft:sweet_berry_bush',
]);
function esperar(ticks) {
    return new Promise((resolve) => system.runTimeout(resolve, ticks));
}
async function buscarDestino(player) {
    const dimension = world.getDimension('overworld');
    if (player.dimension.id !== dimension.id) {
        player.sendMessage('§cTPR sólo está disponible en el mundo principal.');
        return;
    }
    player.sendMessage('§eBuscando un destino seguro…');
    for (let intento = 0; intento < MAX_INTENTOS; intento += 1) {
        let marcador;
        try {
            const etiqueta = `spb_tpr_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
            marcador = dimension.spawnEntity('minecraft:armor_stand', player.location);
            marcador.addTag(etiqueta);
            dimension.runCommand(`spreadplayers 0 0 ${DISTANCIA_MINIMA} ${DISTANCIA_MAXIMA} @e[type=armor_stand,tag=${etiqueta}]`);
            for (let transcurridos = 0; transcurridos < MAX_ESPERA_TICKS; transcurridos += 2) {
                await esperar(2);
                if (!player.isValid || player.dimension.id !== dimension.id)
                    return;
                if (!marcador.isValid)
                    break;
                const ubicacion = marcador.location;
                const x = Math.floor(ubicacion.x);
                const z = Math.floor(ubicacion.z);
                if (!dimension.isChunkLoaded({ x, y: 64, z }))
                    continue;
                const superficie = dimension.getBlockBelow({
                    x,
                    y: dimension.heightRange.max - 1,
                    z,
                });
                if (!superficie ||
                    superficie.isAir ||
                    superficie.isLiquid ||
                    BLOQUES_PELIGROSOS.has(superficie.typeId))
                    break;
                const y = superficie.location.y + 1;
                const pies = dimension.getBlock({ x, y, z });
                const cabeza = dimension.getBlock({ x, y: y + 1, z });
                if (!pies?.isAir || !cabeza?.isAir)
                    break;
                if (player.tryTeleport({ x: x + 0.5, y, z: z + 0.5 }, { dimension, checkForBlocks: true, keepVelocity: false })) {
                    player.sendMessage('§aTe teletransportaste a una ubicación segura.');
                    return;
                }
                break;
            }
        }
        catch {
            // El destino o su chunk no están listos; se prueba otro sin mover al jugador.
        }
        finally {
            try {
                if (marcador?.isValid)
                    marcador.remove();
            }
            catch {
                // El marcador puede descargarse al cambiar de chunk.
            }
        }
    }
    if (player.isValid)
        player.sendMessage('§cNo se encontró un destino seguro. No se realizó el TPR.');
}
export function teletransportarAleatoriamente(player) {
    const id = player.id;
    if (TELETRANSPORTES_EN_CURSO.has(id)) {
        player.sendMessage('§eYa se está buscando un destino para ti.');
        return;
    }
    TELETRANSPORTES_EN_CURSO.add(id);
    void buscarDestino(player)
        .catch(() => {
        if (player.isValid)
            player.sendMessage('§cNo se pudo completar la búsqueda de un destino.');
    })
        .finally(() => TELETRANSPORTES_EN_CURSO.delete(id));
}
//# sourceMappingURL=tpr.js.map