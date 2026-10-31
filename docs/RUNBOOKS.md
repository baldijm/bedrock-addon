# Runbooks breves de SPB

## Dashboard Worker

1. Revisar el cambio y confirmar que no incluye secretos ni archivos ajenos.
2. Desde `dashboard/`, ejecutar `npm run check` y `npm run build`.
3. Publicar con Wrangler sólo con autorización del usuario.
4. Confirmar la versión publicada y probar la ruta afectada como administrador.

## Activar estructuras en Staging

1. Publicar el archivo en la biblioteca R2; aún no altera ningún mundo.
2. En `/structures`, activar Staging.
3. Observar progreso por estructura y bytes. Cada parte se transfiere y confirma
   antes de la siguiente.
4. Al final, el bridge recibe `stop` y vuelve a arrancar Staging; esperar que
   BDS complete su arranque antes de probar una colocación.
5. Si falla, conservar el nombre, fase y mensaje. No reintentar a ciegas ni
   repetir toda la biblioteca si el error apunta a una estructura concreta.

## Diagnóstico de conectividad Bedrock

1. Identificar entorno y endpoint exacto: Producción `:19132`, Staging `:19134`.
2. Comparar `server.properties`, servicio, logs y reglas de red del entorno que
   falla con el que funciona.
3. Verificar primero que el cliente está usando el host/puerto correctos.
4. No modificar DNS de Xbox, router, NSG ni BDS simultáneamente: cambia una
   variable y registra el resultado.

## Azure / BDS

Antes de una modificación: comprobar por lectura el servicio objetivo, logs,
puertos y directorio. Respaldar mundos antes de acciones que puedan alterarlos.
No reiniciar Producción ni modificar su mundo sin autorización explícita.
