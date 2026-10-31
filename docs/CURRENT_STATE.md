# Estado operativo actual

Actualiza este documento al realizar un cambio operativo confirmado. No contiene
secretos, credenciales ni valores de configuración privados.

## Entornos Bedrock

| Entorno | Directorio en VM | Puerto público | Servicio principal |
| --- | --- | --- | --- |
| Producción | `/opt/bedrock` | UDP/TCP `19132` | `bedrock.service` |
| Staging | `/opt/bedrock-staging` | UDP/TCP `19134` | `bedrock-staging.service` |

- Punto de entrada confirmado para Producción: `smp.baldijm.com:19132`.
- Punto de entrada confirmado para Staging: `smp.baldijm.com:19134`.
- Ambos BDS usan NetherNet. No modificar puertos, `transport`, NSG o firewall
  sólo para diagnosticar un error de cliente: primero comparar con el entorno
  que sí funciona y revisar logs.
- El bridge de Staging se opera mediante `spb-staging-bridge.service`. Producción
  tiene su bridge/observador separado.

## Dashboard y Cloudflare

- Worker: `spb-console` en `spb-console.baldijm.workers.dev`.
- Biblioteca nueva de estructuras: R2 `spb-structures`; metadatos: D1
  `spb-console`.
- Máximo de importación configurable: hasta 150 MiB. Archivos válidos pequeños
  no tienen un mínimo práctico superior a un byte.
- La activación de estructuras es exclusiva de Staging y usa transferencias de
  10 MiB por petición: una biblioteca completa nunca debe viajar en una única
  invocación del Worker, pues Cloudflare limita las subrequests por invocación.
- La pantalla debe informar estructura actual, bytes, fase de verificación y
  reinicio, no sólo “Activando”.

## Reglas de estructuras

- Importar o exportar a biblioteca no modifica mundos.
- `structure load` puede necesitar chunks cargados; una aceptación de BDS no es
  por sí sola prueba de que el bloque cambió.
- Las colocaciones pueden usar: colocar bloques, incluir aire y protecciones de
  romper, colocar y daño ambiental. Validar primero en Staging.
- Bedrock sólo descubre archivos nuevos del behavior pack al arrancar; por eso
  activar estructuras reinicia únicamente Staging.

## Situación del repositorio

El árbol de trabajo puede contener modificaciones del usuario, sobre todo bajo
`BP/scripts/` y `gateway/`. Trátalas como ajenas salvo que la tarea las nombre
explícitamente. Confirma `git status` antes de editar o preparar commits.
