# Respaldo de datos Bedrock

`world_backup.py` archiva **todos** los mundos de `worlds/`, `server.properties`, `allowlist.json` y `permissions.json`. El mundo activo se selecciona mediante `level-name` en `server.properties`; en la revisión de Azure del 22 de octubre de 2026 era `Bedrock HTTP Test`. Los otros mundos también se conservan. El archivo no incluye `.api-token`, otros secretos ni el binario del servidor.

La herramienta solo crea el archivo cuando `bedrock.service` y `bedrock_server` no están activos. **No detiene ni reinicia el servidor**. El operador debe garantizar que siga detenido durante toda la copia; el programa comprueba el estado antes y después. No se ha ejecutado sobre producción.

Ejemplo para un servidor detenido, sujeto a una ventana de mantenimiento autorizada:

```sh
python3 ops/world_backup.py create --root /opt/bedrock --output /ruta-privada/bedrock-20261022.tar.gz
python3 ops/world_backup.py verify /ruta-privada/bedrock-20261022.tar.gz
```

La herramienta crea el archivo con permisos privados y muestra su SHA-256. Para comprobar una restauración sin tocar producción:

```sh
python3 ops/world_backup.py restore-lab /ruta-privada/bedrock-20261022.tar.gz /tmp/bedrock-restore-lab
```

La carpeta de restauración debe ser nueva. La verificación comprueba los hashes de los archivos y rechaza rutas peligrosas antes de extraer. Después se deben probar el arranque y el acceso a Minecraft en una instalación aislada. Un archivo verificado por sí solo no demuestra que el mundo arranque.

## Pendiente para R2 y migración

Antes de automatizar, definir una ventana o un método probado para obtener una copia consistente sin detener el servicio, la política de retención, el cifrado previo a la subida y credenciales R2 limitadas al bucket de respaldos. Subir un archivo, automatizar el calendario y restaurar sobre una instalación real son operaciones separadas que aún no están implementadas. No usar el OAuth amplio de Cloudflare como credencial de respaldo.
