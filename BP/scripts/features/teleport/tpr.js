import { world } from '@minecraft/server';
const DISTANCIA_MINIMA = 300;
const DISTANCIA_MAXIMA = 2500;
const MAX_INTENTOS = 6;
const BLOQUES_PELIGROSOS = new Set([
    'minecraft:cactus',
    'minecraft:campfire',
    'minecraft:fire',
    'minecraft:magma',
    'minecraft:soul_campfire',
    'minecraft:sweet_berry_bush'
]);
function crearEtiquetaTemporal() {
    return `spb_tpr_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
}
export function teletransportarAleatoriamente(player) {
    const etiqueta = crearEtiquetaTemporal();
    const dimension = world.getDimension('overworld');
    try {
        player.addTag(etiqueta);
        for (let intento = 0; intento < MAX_INTENTOS; intento += 1) {
            dimension.runCommand(`spreadplayers 0 0 ${DISTANCIA_MINIMA} ${DISTANCIA_MAXIMA} @a[tag=${etiqueta}]`);
            const ubicacion = player.location;
            const superficie = dimension.getTopmostBlock({
                x: Math.floor(ubicacion.x),
                z: Math.floor(ubicacion.z)
            });
            if (!superficie ||
                superficie.isAir ||
                superficie.isLiquid ||
                BLOQUES_PELIGROSOS.has(superficie.typeId))
                continue;
            const { x, y, z } = superficie.location;
            const pies = dimension.getBlock({ x, y: y + 1, z });
            const cabeza = dimension.getBlock({ x, y: y + 2, z });
            if (!pies?.isAir || !cabeza?.isAir)
                continue;
            player.teleport({ x: x + 0.5, y: y + 1, z: z + 0.5 }, { dimension });
            player.sendMessage('§aTe teletransportaste a una ubicación aleatoria segura.');
            return;
        }
        player.sendMessage('§cNo se encontró una superficie segura. Inténtalo de nuevo.');
    }
    catch (error) {
        player.sendMessage(`§cNo se pudo encontrar una ubicación aleatoria segura: ${String(error)}`);
    }
    finally {
        try {
            player.removeTag(etiqueta);
        }
        catch {
            // El jugador pudo desconectarse mientras se ejecutaba el comando.
        }
    }
}
//# sourceMappingURL=tpr.js.map