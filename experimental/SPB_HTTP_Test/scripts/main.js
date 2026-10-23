import { secrets, variables } from "@minecraft/server-admin";
import {
    http,
    HttpRequest,
    HttpRequestMethod,
    HttpHeader
} from "@minecraft/server-net";
import {
    world,
    system,
    EntityComponentTypes,
    CustomCommandParamType,
    CustomCommandStatus
} from "@minecraft/server";

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

/**
 * Puente de consola: staging consulta una orden pendiente y devuelve el
 * resultado. Sólo se activa con variables privadas de staging; producción no
 * registra ni ejecuta este ciclo.
 */
async function solicitudConsola(ruta, datos) {
    try {
        const token = secrets.get("SPB_CONSOLE_TOKEN");
        const base = variables.get("SPB_CONSOLE_API_URL");
        if (!token || !base) {
            console.error("[SPB CONSOLA] Credencial o URL no disponibles");
            return null;
        }

        const request = new HttpRequest(String(base).replace(/\/$/, "") + ruta);
        request.method = HttpRequestMethod.Post;
        request.headers = [
            new HttpHeader("Content-Type", "application/json"),
            new HttpHeader("Authorization", token)
        ];
        request.body = JSON.stringify(datos || {});

        const response = await http.request(request);
        if (response.status !== 200) {
            console.error("[SPB CONSOLA] API rechazó la solicitud. HTTP " + response.status);
            return null;
        }
        return JSON.parse(response.body);
    } catch (error) {
        console.error("[SPB CONSOLA] Error de comunicación: " + String(error));
        return null;
    }
}

let consolaOcupada = false;

async function procesarConsolaStaging() {
    if (consolaOcupada) return;
    consolaOcupada = true;
    try {
        const respuesta = await solicitudConsola("/internal/staging/next");
        const orden = respuesta?.command;
        if (!orden?.id || !orden?.command) return;

        let ok = true;
        let resultado = "";
        try {
            const ejecucion = world.getDimension("minecraft:overworld").runCommand(String(orden.command));
            resultado = ejecucion.statusMessage || "Comando ejecutado. Afectados: " + ejecucion.successCount;
        } catch (error) {
            ok = false;
            resultado = String(error);
        }

        await solicitudConsola("/internal/staging/result/" + encodeURIComponent(String(orden.id)), {
            ok,
            result: resultado
        });
    } finally {
        consolaOcupada = false;
    }
}


console.warn("[SPB API] Módulo de comunicación cargado");

if (String(variables.get("SPB_ENABLE_CONSOLE")) === "true") {
    system.runInterval(() => {
        void procesarConsolaStaging();
    }, 100);
    console.warn("[SPB CONSOLA] Puente de consola de staging habilitado");
}

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

    // Sólo staging habilita esta variable. Producción no registra una acción
    // que pueda enviar solicitudes de prueba a su API.
    if (String(variables.get("SPB_ENABLE_API_TEST")) === "true") {
        customCommandRegistry.registerCommand(
            {
                name: "spb:api_test",
                description: "Prueba la API aislada de staging",
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
                system.run(async () => {
                    const response = await enviarSPB({ type: "staging_probe" });
                    player.sendMessage(
                        response?.ok
                            ? "[SPB] API de staging respondió correctamente."
                            : "[SPB] La API de staging no respondió."
                    );
                });
                return { status: CustomCommandStatus.Success };
            }
        );
        console.warn("[SPB API] Comando de prueba de staging registrado");
    }
});
