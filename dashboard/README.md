# Consola de SPB

Consola web privada para administrar los entornos de Minecraft Bedrock. Es una aplicación SvelteKit desplegable en Cloudflare Workers. El Worker se comunica con cada bridge local mediante Cloudflare Tunnel y secretos independientes de alta entropía.

No se conecta por SSH al servidor, no ejecuta comandos de Linux y no incluye ninguna ruta ni credencial de producción.

## Flujo

1. El administrador inicia sesión en la consola web y escribe un comando normal de Minecraft (por ejemplo, `list` o `say hola`).
2. El Worker autentica la llamada ante el bridge de staging con un secreto que nunca llega al navegador.
3. Cloudflare Tunnel entrega la solicitud al bridge persistente que escucha exclusivamente en `127.0.0.1:3002` de la VM.
4. El bridge es el proceso padre de `bedrock_server`: escribe el comando en su entrada estándar y expone las últimas líneas reales de su salida.

La consola usa texto libre: no existe un registro artificial de comandos permitidos. Aun así, el alcance real es el de los comandos de la consola de Bedrock, no una terminal del sistema operativo. La confirmación de entrega no es una afirmación de que un comando haya surtido el efecto esperado dentro del juego; la salida real del servidor es la evidencia disponible.

## Recursos Cloudflare

- Worker: `spb-console`.
- D1: `spb-console` (`0f9568ae-a086-4674-9918-e335c14d5149`), conservado para una futura bitácora administrativa.
- Tunnel: `spb-staging-console`, con hostname `staging-bridge.baldijm.com`.
- El hostname es únicamente la entrada del túnel; el navegador nunca recibe el secreto del bridge. Este bridge también rechaza llamadas sin el secreto y escucha sólo en loopback.

El Worker requiere estos secretos, que se guardan en Cloudflare y nunca en Git:

- `ADMIN_PASSWORD`: contraseña del administrador de la consola.
- `SESSION_SECRET`: secreto aleatorio para firmar la cookie de sesión.
- `STAGING_SERVER_TOKEN`: secreto del mecanismo temporal de cola del add-on; no se usa por el bridge.
- `STAGING_BRIDGE_URL`: `https://staging-bridge.baldijm.com`.
- `STAGING_BRIDGE_TOKEN`: secreto aleatorio compartido sólo entre Worker y bridge.
- `GITHUB_STRUCTURES_TOKEN`: fine-grained token de GitHub, limitado al repositorio del add-on y al permiso **Contents: Read and write**. Se usa exclusivamente para versionar archivos `.mcstructure` en `BP/structures/spb`.

## Biblioteca de estructuras

La ruta `/structures` separa los dos pasos que Bedrock suele mezclar:

1. **Exportar/importar** publica un archivo `.mcstructure` en GitHub, que es la biblioteca versionada y la fuente de verdad.
2. El flujo de despliegue de add-ons distribuye esa biblioteca a staging; producción se actualiza únicamente mediante su promoción autorizada.
3. **Colocar** carga una estructura ya desplegada con `structure load`; pide coordenadas y una confirmación literal antes de modificar el mundo del entorno elegido.

Para exportar desde un mundo, primero se guarda con Structure Block usando **Save to Disk**. El bridge emite `save hold`, espera la confirmación real de Bedrock `Data saved. Files are now ready to be copied.`, toma una copia temporal privada, ejecuta el extractor sobre la copia y siempre envía `save resume`. El mundo original no se reemplaza ni se reinicia durante ese proceso.

## Activar staging después del despliegue

El bridge se instala exclusivamente en staging con `ops/install_console_bridge.sh`. Su secreto vive fuera de Git en `/etc/bedrock-staging-console/bridge.env` con permiso `0600`. `spb-staging-bridge.service` permanece activo durante el mantenimiento y `bedrock-staging.service` controla únicamente el proceso hijo de Minecraft; producción permanece deliberadamente sin tocar.

El conector saliente de Cloudflare se instala con `ops/install_cloudflared_tunnel.sh`; su token vive en `/etc/cloudflared/spb-staging-bridge.env` con permiso `0640` y grupo `cloudflared`. No se abre ningún puerto adicional en Azure. Si más adelante se habilita Cloudflare Access sin aceptar un plan que autorice cargos, puede añadirse como una capa adicional; no es requisito para que el bridge rechace accesos no autorizados.

El mecanismo anterior basado en el add-on queda desactivado en staging una vez que se comprueba el bridge. Producción debe conservar `SPB_ENABLE_CONSOLE` ausente o distinto de `true`.

## Desarrollo y verificación

El proyecto requiere una versión de Node compatible con el `engines` de las dependencias. Desde esta carpeta:

```powershell
npm run build
npm run lint
```

Para el despliegue se deben aplicar las migraciones D1 y configurar los tres secretos antes de exponer la URL. El primer despliegue y cualquier posterior activación de producción requieren una autorización explícita.

Después de publicar una nueva versión del Worker, comprobar que los tres secretos siguen presentes en la versión activa. Si se vuelve a cargar alguno con Wrangler, hacerlo después de `wrangler deploy`; los valores nunca se añaden al repositorio ni a `wrangler.jsonc`.
