import { EntityComponentTypes, ItemStack } from '@minecraft/server';
export const RED_DIAMOND = 'spb:red_diamond';
function obtenerInventario(player) {
    const inventario = player.getComponent(EntityComponentTypes.Inventory);
    if (!inventario) {
        throw new Error('No se pudo acceder al inventario del jugador.');
    }
    return inventario.container;
}
export function contarRedDiamonds(player) {
    const inventario = obtenerInventario(player);
    let total = 0;
    for (let ranura = 0; ranura < inventario.size; ranura += 1) {
        const item = inventario.getItem(ranura);
        if (item?.typeId === RED_DIAMOND)
            total += item.amount;
    }
    return total;
}
/** Entrega red diamonds; lo que no quepa en el inventario cae junto al jugador. */
export function entregarRedDiamonds(player, cantidad) {
    if (!Number.isInteger(cantidad) || cantidad <= 0) {
        throw new Error('La cantidad de red diamonds debe ser un entero positivo.');
    }
    const inventario = obtenerInventario(player);
    let restantes = cantidad;
    while (restantes > 0) {
        const lote = Math.min(restantes, 64);
        const sobrante = inventario.addItem(new ItemStack(RED_DIAMOND, lote));
        if (sobrante) {
            player.dimension.spawnItem(sobrante, player.location);
        }
        restantes -= lote;
    }
}
/**
 * Consume red diamonds únicamente si el inventario contiene el total pedido.
 * Devuelve false sin modificar el inventario cuando el saldo es insuficiente.
 */
export function intentarPagarConRedDiamonds(player, cantidad) {
    if (!Number.isInteger(cantidad) || cantidad <= 0) {
        throw new Error('El precio debe ser un entero positivo.');
    }
    if (contarRedDiamonds(player) < cantidad)
        return false;
    const inventario = obtenerInventario(player);
    let pendiente = cantidad;
    for (let ranura = 0; ranura < inventario.size && pendiente > 0; ranura += 1) {
        const item = inventario.getItem(ranura);
        if (item?.typeId !== RED_DIAMOND)
            continue;
        if (item.amount <= pendiente) {
            pendiente -= item.amount;
            inventario.setItem(ranura);
            continue;
        }
        item.amount -= pendiente;
        inventario.setItem(ranura, item);
        pendiente = 0;
    }
    return true;
}
//# sourceMappingURL=moneda.js.map