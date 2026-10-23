import { secrets, variables } from "@minecraft/server-admin";
import {
    http,
    HttpRequest,
    HttpRequestMethod,
    HttpHeader
} from "@minecraft/server-net";

/**
 * Envía información del servidor Minecraft a la API local.
 * No incluye credenciales directamente en el código.
 */
export async function enviarSPB(datos) {
    try {
        const token = secrets.get("SPB_API_TOKEN");

        if (!token) {
            console.error("[SPB API] Credencial no disponible");
            return null;
        }

        // Producción conserva su URL actual si no se configuró una variable.
        // Staging define SPB_API_URL en config/default/variables.json.
        const endpoint = variables.get("SPB_API_URL") || "http://127.0.0.1:3000/spb/test";
        const request = new HttpRequest(String(endpoint));

        request.method = HttpRequestMethod.Post;

        request.headers = [
            new HttpHeader("Content-Type", "application/json"),
            new HttpHeader("x-api-token", token)
        ];

        request.body = JSON.stringify(datos);

        const response = await http.request(request);

        if (response.status !== 200) {
            console.error(
                "[SPB API] Solicitud rechazada. HTTP " + response.status
            );
            return null;
        }

        return JSON.parse(response.body);

    } catch (error) {
        console.error("[SPB API] Error de comunicación: " + String(error));
        return null;
    }
}


console.warn("[SPB API] Módulo de comunicación cargado");

import { world, system, EntityComponentTypes, CustomCommandParamType, CustomCommandStatus } from "@minecraft/server";

system.beforeEvents.startup.subscribe(({ customCommandRegistry }) => {
    customCommandRegistry.registerCommand(
        {
            name: "spb:saldo",
            description: "Consulta tus Red Diamonds",
            permissionLevel: 0,
            cheatsRequired: false
        },
        (origin) => {
            const player = origin.sourceEntity;

            if (!player || player.typeId !== "minecraft:player") {
                return {
                    status: CustomCommandStatus.Failure,
                    message: "Este comando debe ejecutarlo un jugador."
                };
            }

            system.run(() => {
                try {
                    const inventory = player.getComponent(EntityComponentTypes.Inventory)?.container;
                    if (!inventory) throw new Error("Inventario no disponible");

                    let saldo = 0;

                    for (let i = 0; i < inventory.size; i++) {
                        const item = inventory.getItem(i);
                        if (item?.typeId === "spb:red_diamond") {
                            saldo += item.amount;
                        }
                    }

                    player.sendMessage("[SPB] Tienes " + saldo + " Red Diamonds.");
                } catch (error) {
                    console.error("[SPB SALDO] " + String(error));
                    player.sendMessage("[SPB] No se pudo consultar tu saldo.");
                }
            });

            return { status: CustomCommandStatus.Success };
        }
    );

    console.warn("[SPB SALDO] Comando registrado");
});
