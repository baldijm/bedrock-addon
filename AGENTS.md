# SPB — instrucciones para agentes

SPB administra servidores Minecraft Bedrock con un dashboard privado. Trabaja
con precisión, en español y con cambios pequeños y verificables.

## Inicio automático de cada tarea

Antes de diagnosticar o cambiar algo, consulta `docs/PROJECT_CONTEXT.md` y la
sección aplicable de `docs/CURRENT_STATE.md`. Consulta `docs/RUNBOOKS.md` sólo
si la tarea es operativa (despliegue, Azure, Cloudflare, estructuras o red).
No pidas al usuario que te recuerde estos archivos.

## Límites de seguridad

- Nunca muestres, imprimas ni añadas secretos, contraseñas, tokens ni llaves al
  repositorio o a respuestas.
- Staging y Producción son entornos distintos. No cambies Producción como parte
  de una prueba de Staging.
- No reinicies/detengas BDS, modifiques mundos, NSG, DNS, túneles, secretos o
  despliegues externos sin autorización expresa y actual del usuario.
- Antes de una acción de riesgo, inspecciona el estado real; no asumas que un
  documento antiguo sigue siendo verdad.
- Respeta cambios no relacionados en el árbol de trabajo. No uses `git reset
  --hard` ni `git checkout --`.

## Forma de trabajo

- Para investigar: explica causa, evidencia y alcance antes de proponer un
  cambio. No hagas cambios sólo por intuición.
- Para implementar: valida con las comprobaciones pertinentes y comunica el
  resultado de manera concreta.
- Para UI larga (carga, activación, colocación): mostrar fases, avance y errores
  accionables; no dejar al usuario únicamente con “Procesando…”.
- Actualiza `docs/CURRENT_STATE.md` cuando cambie un componente, ruta, puerto,
  flujo operativo o decisión relevante. Registra el motivo en
  `docs/DECISIONS.md` si evita que se repita un problema.

## Rutas principales

- Dashboard Worker: `dashboard/`.
- Add-on Bedrock: `BP/` y `RP/`.
- Operación de VM, bridges y despliegues: `ops/`.
- La documentación histórica fuera de `docs/` puede orientar, pero no sustituye
  el estado actual ni una comprobación de lectura en el sistema correspondiente.
