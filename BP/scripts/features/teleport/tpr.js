import { world } from '@minecraft/server';
const DISTANCIA_MINIMA = 300;
const DISTANCIA_MAXIMA = 2500;
function crearEtiquetaTemporal() {
    return `spb_tpr_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
}
export function teletransportarAleatoriamente(player) {
    const etiqueta = crearEtiquetaTemporal();
    try {
        player.addTag(etiqueta);
        world
            .getDimension('overworld')
            .runCommand(`spreadplayers 0 0 ${DISTANCIA_MINIMA} ${DISTANCIA_MAXIMA} @a[tag=${etiqueta}]`);
        player.sendMessage('§aTe teletransportaste a una ubicación aleatoria.');
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