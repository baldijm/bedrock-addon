# Staging de Minecraft Bedrock

Staging es un servidor efímero de prueba. Su mundo parte de un respaldo
verificado de producción, pero **nunca** se promueve de vuelta a producción:
la única promoción admisible es la del código/configuración del add-on que haya
sido probado.

## Aislamiento actual

- Directorio: `/opt/bedrock-staging`.
- Puerto Bedrock: UDP `19134` (IPv6 `19135`).
- Servicio: `bedrock-staging.service`; queda deshabilitado y apagado por
  defecto. Se inicia sólo para una sesión de pruebas.
- El archivo de credencial de producción no se copia a staging y el servicio
  vacía `SPB_API_TOKEN`.
- El servicio no recibe `SPB_API_TOKEN` y el archivo de credencial de
  producción no se copia. Como el módulo HTTP no hace una solicitud sin esa
  credencial, una sesión normal de staging no alcanza la API real. Para probar
  la integración HTTP se necesita una API y credencial de **staging** separadas;
  no reutilizar las de producción. Esto no es una afirmación de salud ni una
  prueba de la API.

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

## Pendiente deliberado

La integración GitHub -> staging debe usar una credencial de lectura limitada
(por ejemplo, una deploy key) y un commit explícito. No guardar tokens de
GitHub, secretos de R2 ni contraseñas en este repositorio.
