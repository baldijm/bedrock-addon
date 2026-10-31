# Contexto del proyecto SPB

SPB es una consola privada para operar dos servidores Minecraft Bedrock:
**Staging** para pruebas y **Producción** para el mundo real. El propósito es
administrar el juego sin dar acceso de shell desde el navegador y sin confundir
pruebas con cambios del mundo de producción.

## Componentes

| Componente | Responsabilidad |
| --- | --- |
| `dashboard/` | SvelteKit en Cloudflare Workers; UI autenticada y API privada. |
| Cloudflare D1 | Ajustes y metadatos de la biblioteca de estructuras. |
| Cloudflare R2 | Binarios privados `.mcstructure` versionados por nombre. |
| Cloudflare Tunnel | Conecta el Worker con los bridges locales sin exponerlos públicamente. |
| `ops/bedrock_console_bridge.py` | Bridge que controla BDS por stdin/stdout, recibe estructuras y confirma resultados. |
| `BP/`, `RP/` | Add-on y resource pack de Bedrock. |
| Azure VM | Ejecuta BDS de Producción y Staging de forma aislada. |

## Principios del producto

1. El dashboard nunca es una terminal Linux.
2. El bridge autenticado es quien habla con BDS; el navegador no conoce su
   secreto.
3. Toda operación que modifique un mundo debe ser visible, confirmada y tener
   resultados verificables.
4. Staging sirve para validar cambios primero; no debe alterar Producción.
5. La biblioteca de estructuras nueva usa R2. Publicarla no modifica un mundo;
   activarla la copia al behavior pack de Staging y reinicia sólo Staging para
   que Bedrock descubra los archivos.

## Lectura de código por tema

- Estructuras y carga: `dashboard/src/routes/structures/+page.svelte`,
  `dashboard/src/routes/api/structures/`,
  `dashboard/src/lib/server/structure-library.ts`.
- Comunicación con BDS: `dashboard/src/lib/server/bridge.ts` y
  `ops/bedrock_console_bridge.py`.
- Configuración de BDS/despliegues: `ops/` y sus documentos cercanos.

Los nombres, versiones y topología pueden cambiar: para detalles operativos
vigentes, usar `CURRENT_STATE.md` y comprobarlos antes de actuar.
