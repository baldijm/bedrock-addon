# Respaldo de datos Bedrock

`world_backup.py` archiva **todos** los mundos de `worlds/`, `server.properties`, `allowlist.json` y `permissions.json`. El mundo activo se selecciona mediante `level-name` en `server.properties`; en la revisión de Azure del 22 de octubre de 2026 era `Bedrock HTTP Test`. Los otros mundos también se conservan. El archivo no incluye `.api-token`, otros secretos ni el binario del servidor.

La herramienta solo crea el archivo cuando `bedrock.service` y `bedrock_server` no están activos. **Por sí misma no detiene ni reinicia el servidor**. El operador debe garantizar que siga detenido durante toda la copia; el programa comprueba el estado antes y después. El 22 de octubre de 2026 se usó sobre producción dentro de una ventana de mantenimiento autorizada, mediante `production_backup.py`, que detuvo Bedrock, creó y verificó el archivo, e inició el servicio de nuevo antes de subirlo a R2.

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

## Destino R2 y cifrado

El 22 de octubre de 2026 se creó en la cuenta actual de Cloudflare el bucket privado `spb-bedrock-world-backups`, con clase **Standard**, y un token de cuenta `spb-bedrock-backups` con permiso **Object Read & Write** limitado únicamente a ese bucket. El bucket estaba vacío al crearse. Estos datos identifican el destino, pero **no constituyen un respaldo**. No guardar en Git el Access Key ID, Secret Access Key, la contraseña de cifrado ni archivos que los contengan. No usar el OAuth amplio de Cloudflare como credencial del respaldo.

La opción prevista para subir archivos es [restic](https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html), que cifra el repositorio antes de enviar datos a un destino S3 compatible. Requiere tres secretos independientes de Git: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` y una contraseña fuerte de restic, pasada al proceso como `RESTIC_PASSWORD`. La contraseña de restic **no es** la clave de Cloudflare; perderla impide restaurar el repositorio cifrado. Mantener copias recuperables de estos secretos fuera de Azure y de GitHub, con acceso restringido. Una futura migración cambiaría el destino R2 y las credenciales, conservando el procedimiento de respaldo y restauración.

El 22 de octubre de 2026 se instaló `restic 0.16.4` desde el repositorio de Ubuntu en la VM Azure; `bedrock.service` seguía activo después de la instalación. Después se guardaron los tres secretos en `/etc/bedrock-backup/r2.json`: la carpeta se verificó con permisos `0700`, el archivo con `0600`, ambos propiedad de root, y Bedrock seguía activo. **Solo se verificaron existencia y permisos, nunca se imprimieron los valores.** Posteriormente se inicializó el repositorio cifrado R2 y se probó una subida y restauración con un archivo ficticio de 256 bytes. `restic check` terminó correctamente y el archivo restaurado coincidió. El snapshot de laboratorio permanece en R2. **Esto no es un respaldo del mundo ni una prueba de salud de Minecraft.**

`configure_r2_secrets.py` prepara un único archivo privado `/etc/bedrock-backup/r2.json` con las dos claves R2 y la contraseña distinta de restic. Solo se ejecuta manualmente en una terminal interactiva como root: solicita los tres valores sin mostrarlos, rechaza sobrescribir una configuración previa, crea la carpeta con permisos `0700` y el archivo con `0600`. No imprime secretos, no conecta a R2 y no modifica Minecraft. La persona propietaria debe introducir los valores directamente desde su gestor de contraseñas; nunca enviarlos por chat ni como argumentos de línea de comandos. La configuración permanece fuera del repositorio y no sustituye una copia segura de recuperación de la contraseña de restic.

```text
RESTIC_REPOSITORY=s3:https://<ACCOUNT_ID>.r2.cloudflarestorage.com/spb-bedrock-world-backups
```

El flujo previsto es:

1. **Hecho:** validar en un laboratorio que la versión instalada de restic puede crear y abrir el repositorio R2 con el token limitado, sin imprimir secretos. `r2_lab.py init` inicializa el repositorio cifrado **una sola vez** en el bucket esperado; ya se ejecutó y **no debe repetirse**. `r2_lab.py probe` sube solo 256 bytes ficticios, revisa el repositorio y restaura ese archivo en una carpeta temporal; `r2_lab.py init-and-probe` realizó ambas acciones en la primera ejecución. No leyó el mundo ni modificó el servicio. La prueba dejó su snapshot en R2 para una revisión posterior y no configuró retención.
2. **Hecho con autorización expresa:** obtener un archivo consistente con `world_backup.py create` durante una ventana de mantenimiento. `production_backup.py` hizo comprobaciones antes de detener el servicio, reinició Bedrock en un bloque de recuperación aunque fallara el archivado, y confirmó `bedrock.service` activo junto con el proceso `bedrock_server`. No ejecutar `--apply`, detener ni reiniciar producción de nuevo sin autorización expresa.
3. **Hecho parcialmente:** verificar el archivo local, subirlo con restic, ejecutar `restic check --read-data`, restaurar el snapshot a una carpeta **nueva**, comparar SHA-256, verificar el manifiesto y extraer los datos en laboratorio. Todo eso terminó correctamente. **Pendiente:** probar el arranque del mundo y el acceso a Minecraft en una instalación aislada; los hashes y el estado del proceso de producción no son una prueba de salud real del juego.
4. Conservar el archivo local y el respaldo anterior hasta demostrar que el nuevo se restaura. Definir retención y alertas de consumo antes de automatizar; no activar una tarea periódica ni borrar snapshots por ahora.

R2 Standard tiene una asignación mensual gratuita compartida entre los buckets de la cuenta, no una asignación nueva por bucket. El uso puede superar la capa gratuita si los mundos o el número de copias crecen; revisar el [precio vigente de R2](https://developers.cloudflare.com/r2/pricing/) y el panel de facturación antes de fijar frecuencia y retención. La restauración del archivo desde R2 sí se comprobó; falta probar el mundo en Minecraft aislado.

## Registro de la primera copia real (22 de octubre de 2026)

- Datos fuente: `610986` bytes; 24 archivos de mundo/configuración.
- Archivo local privado: `/var/backups/bedrock/bedrock-20261022T230215Z-fe31ab57.tar.gz` (conservar; no borrar automáticamente).
- SHA-256 del archivo: `dbf1ef5b78f390b6e6dc9ada178c83423ad152b92d4851668aea9070892c550d`.
- Snapshot cifrado restic en R2: `39b64d32e210fcc12e04c4d1d397ab73698c2f8c260ff772a28a6d2dada77c22`.
- Resultado: `restic check --read-data`, restauración desde R2, igualdad SHA-256, verificación del manifiesto y extracción en carpeta nueva, todo correcto. Al final `bedrock.service` y `bedrock_server` estaban activos. **No** se verificó el acceso de jugadores ni el arranque aislado del mundo.
- Ni las claves R2 ni la contraseña restic están en GitHub. Sin la contraseña restic no puede restaurarse el snapshot; mantenerla recuperable fuera de la VM y del repositorio.
