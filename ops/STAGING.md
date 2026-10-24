# Staging de Minecraft Bedrock

Staging es un servidor efímero de prueba. Su mundo puede partir de un respaldo
verificado de producción. Para casos de mantenimiento inicial existe una
promoción explícita de mundo completo desde staging: exige confirmación del
nombre del mundo de producción, respaldo verificable en R2 y rollback local.
No fusiona progreso; reemplaza el mundo completo y por ello no se usa como
sincronización cotidiana de jugadores.

## Aislamiento actual

- Directorio: `/opt/bedrock-staging`.
- Puerto Bedrock: `19134` (IPv6 `19135`). Azure debe permitir **UDP y TCP
  19134** mientras se pruebe. La captura de red confirmó llegada de UDP; la
  entrada que finalmente funcionó ocurrió cuando también se permitió TCP. No
  se ha hecho una prueba controlada que demuestre cuál protocolo exige el
  cliente, así que se conservan ambos mientras funciona.
- `enable-lan-visibility=false` en las propiedades de staging evita anunciar
  por LAN dos servidores Bedrock en la misma VM. No cambia producción.
- Servicio: `bedrock-staging.service`, con `bedrock-staging-api.service` como
  dependencia. Puede estar activo para pruebas; no tiene que afectar
  `bedrock.service`.
- El archivo de credencial de producción no se copia a staging y el servicio
  vacía `SPB_API_TOKEN`.
- El servicio no recibe `SPB_API_TOKEN` ni el archivo de credencial de
  producción. La API de pruebas, si está activa, escucha sólo en
  `127.0.0.1:3001`, tiene su propia credencial y no guarda datos. Bedrock toma
  esa URL de `config/fa4cf008-6894-405d-93ca-8c1db6e6f1f5/variables.json` y
  su token de `config/fa4cf008-6894-405d-93ca-8c1db6e6f1f5/secrets.json`
  (el UUID del módulo de script de `SPB_HTTP_Test`); ambos archivos quedan
  fuera de Git. El valor
  `SPB_ENABLE_API_TEST=true` habilita en staging el comando
  `/spb:api_test`, que envía únicamente `{ "type": "staging_probe" }` y no
  datos de jugadores ni del mundo. No
  reutilizar las credenciales ni la API de producción. Esto no es una
  afirmación de salud de producción.

## Antes de que un jugador entre

1. Crear una regla de entrada en el NSG de Azure para **UDP 19134**, limitada
   a las IPs de los probadores siempre que sea posible. La regla no implica
   costos directos, pero es una superficie adicional que se debe cerrar cuando
   ya no se use.
2. Iniciar manualmente `bedrock-staging.service` y comprobar sus registros.
   Esto no requiere tocar `bedrock.service`.
3. Detener staging al terminar la sesión. No habilitarlo al arranque mientras
   siga siendo un entorno bajo demanda.

## Flujo de cambios

1. Crear una rama de trabajo y subirla a GitHub.
2. Desplegar **sólo** los paquetes BP/RP de ese commit en staging; conservar el
   mundo de staging durante las iteraciones.
3. Probar en `19134`, incluyendo los flujos que no deben llegar a la API real.
4. Tras aceptar el cambio, fusionarlo en `main`.
5. En una ventana de mantenimiento autorizada: respaldo de producción,
   despliegue del commit ya probado y reinicio controlado de producción.

No se ejecuta `--apply`, no se reinicia ni se detiene producción por este flujo
sin autorización expresa del operador.

## Automatización GitHub → staging

`addon_deploy.py` sólo acepta un SHA completo de 40 caracteres. Obtiene ese
objeto exacto desde `https://github.com/baldijm/bedrock-addon.git`, valida los
tres paquetes (`BP`, `RP` y `experimental/SPB_HTTP_Test`), conserva las copias
anteriores como rollback y reemplaza únicamente esos paquetes. No toca mundos,
credenciales ni configuración de staging. Al final reinicia **sólo** staging y
escribe un recibo local con el commit desplegado.

En la VM se instala en `/opt/bedrock-deploy` junto con `world_backup.py`,
`production_backup.py` y `r2_lab.py`. Ejemplo de despliegue manual a staging:

```sh
sudo /opt/bedrock-deploy/addon_deploy.py staging --commit <SHA_COMPLETO>
```

El workflow `deploy-staging.yml` hace lo mismo automáticamente para cambios de
paquetes que lleguen a `main`. Antes de habilitarlo, agregar estos secretos al
repositorio de GitHub (no a los archivos del repo):

- `BEDROCK_STAGING_HOST`: IP o nombre DNS de la VM.
- `BEDROCK_STAGING_SSH_KEY`: clave privada exclusiva para ese automatismo,
  limitada en Azure al usuario que ejecuta el despliegue y rotada si se expone.

La clave queda registrada en Azure con `restrict` y un *forced command*:
no permite shell, túneles, reenvío ni comandos distintos de desplegar staging,
o promover producción con su flag explícito. La llave privada se guarda sólo
en el secreto de Actions y se elimina de la estación de trabajo tras guardarla.

Los cambios a las herramientas en `ops/` no reinician staging automáticamente:
se instalan de forma deliberada con `install_deploy_tools.sh` y se validan antes
de usarse. Así un cambio operativo no se mezcla con una actualización de juego.

El workflow de producción **no** se ejecuta con un push. Sólo se puede iniciar
manualmente con un SHA, la frase exacta de autorización y la protección del
entorno `production` de GitHub. Además, el programa exige el flag
`--authorized-production-maintenance`, exige que ese SHA sea el último
desplegado en staging, realiza un respaldo de mundo verificable y sólo entonces
detiene, actualiza y vuelve a iniciar producción. Una falla al subir el respaldo
a R2 deja producción iniciada y conserva el archivo local; se debe investigar,
no reintentar a ciegas.

## Pendiente deliberado

La VM descarga por HTTPS el commit explícito. Si el repositorio se vuelve
privado, usar una deploy key de **solo lectura** limitada a este repositorio;
no guardar tokens de GitHub, secretos de R2 ni contraseñas en este repositorio.

La API mínima para probar el trayecto HTTP está en `staging-api/server.js` y
su unidad en `systemd/bedrock-staging-api.service`. Sólo acepta `POST
/spb/test` con su token de staging y responde sin persistir el cuerpo.
