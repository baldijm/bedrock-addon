# Consola de SPB

Consola web privada para enviar comandos de Minecraft Bedrock al entorno de **staging**. Es una aplicación SvelteKit desplegable en Cloudflare Workers, con Cloudflare D1 como cola y registro de resultados.

No se conecta por SSH al servidor, no ejecuta comandos de Linux y no incluye ninguna ruta ni credencial de producción.

## Flujo

1. El administrador abre la consola web y escribe un comando normal de Minecraft (por ejemplo, `list` o `say hola`).
2. El Worker lo guarda en la cola D1 como una orden de `staging`.
3. El add-on instalado **sólo en staging** consulta la siguiente orden cada cinco segundos.
4. Bedrock ejecuta el texto mediante Script API y el add-on devuelve el resultado a la consola.

La consola usa texto libre: no existe un registro artificial de comandos permitidos. Aun así, el alcance real es el que soporte `runCommand` en Bedrock, no una terminal del sistema operativo.

## Recursos Cloudflare

- Worker: `spb-console`.
- D1: `spb-console` (`0f9568ae-a086-4674-9918-e335c14d5149`).
- Esquema de D1: `migrations/0001_console.sql`.

El Worker requiere estos secretos, que se guardan en Cloudflare y nunca en Git:

- `ADMIN_PASSWORD`: contraseña del administrador de la consola.
- `SESSION_SECRET`: secreto aleatorio para firmar la cookie de sesión.
- `STAGING_SERVER_TOKEN`: secreto aleatorio compartido exclusivamente entre el Worker y el add-on de staging.

## Activar staging después del despliegue

Una vez que exista una URL HTTPS funcional para el Worker, se configura únicamente en el servidor de staging:

- Variable `SPB_ENABLE_CONSOLE=true`.
- Variable `SPB_CONSOLE_API_URL=https://<url-de-la-consola>`.
- Secreto `SPB_CONSOLE_TOKEN`, con el mismo valor que `STAGING_SERVER_TOKEN`.

La configuración vive fuera del repositorio en la ruta de configuración del módulo indicada por `ops/STAGING.md`. Producción debe conservar `SPB_ENABLE_CONSOLE` ausente o distinto de `true`.

## Desarrollo y verificación

El proyecto requiere una versión de Node compatible con el `engines` de las dependencias. Desde esta carpeta:

```powershell
npm run build
npm run lint
```

Para el despliegue se deben aplicar las migraciones D1 y configurar los tres secretos antes de exponer la URL. El primer despliegue y cualquier posterior activación de producción requieren una autorización explícita.

Después de publicar una nueva versión del Worker, comprobar que los tres secretos siguen presentes en la versión activa. Si se vuelve a cargar alguno con Wrangler, hacerlo después de `wrangler deploy`; los valores nunca se añaden al repositorio ni a `wrangler.jsonc`.
