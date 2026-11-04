# Arenas PvP desde el dashboard

La sección `/pvp` configura arenas del entorno seleccionado en el dashboard.
Los datos se guardan dentro del mundo con la propiedad dinámica
`spb:pvp_arenas_v1`. Staging y Producción mantienen configuraciones distintas.

## Uso

1. Construir la arena en Minecraft o colocar su estructura desde Estructuras.
2. En Arenas PvP, crear una arena o editar el borrador existente.
3. Configurar dimensión, posiciones de los dos jugadores, centro de retorno,
   posiciones y orientación de NPCs, límites del área y ambas porterías.
   Para las áreas, escribir dos esquinas opuestas en **De** y **A**, en cualquier
   orden. El dashboard calcula automáticamente los límites de cada eje antes
   de enviarlos a Bedrock, incluyendo coordenadas negativas.
4. Guardar el borrador. Esto no cambia la configuración activa.
5. Activar la arena guardada. Bedrock carga temporalmente la zona y comprueba
   suelo y espacio libre en las cinco posiciones antes de confirmar.

En Producción las operaciones exigen escribir el nombre real del mundo.
La configuración puede cambiar sin reiniciar BDS ni publicar otro BP/RP.
Al guardar cambios de una arena activa se conserva la versión activa anterior
hasta volver a pulsar Activar arena.

## Reglas

- Hasta 12 arenas registradas; una activa y una partida simultánea.
- La arena heredada se presenta como borrador desactivado.
- Una arena desactivada no permite iniciar partidas y no genera NPCs.
- Los NPCs aparecen durante el lobby; el vigilante no genera entidades sin
  partida. Si desaparece el suelo del lobby, la partida se cancela y ambos
  participantes recuperan sus estados anteriores.
- El área segura admite hasta 128 × 128 bloques horizontales y 64 chunks.
  Todas las posiciones y porterías deben quedar dentro. Las porterías no se
  pueden superponer; los NPCs deben separarse al menos cuatro bloques.
- Los cambios quedan bloqueados durante una partida o activación en curso.
- Una revisión impide que dos sesiones sobrescriban sus cambios sin recargar.
- El historial conserva las últimas diez operaciones. El dashboard utiliza
  una sesión administrativa compartida; no atribuye acciones a personas
  individuales.
- Eliminar una arena borra su configuración, no la construcción del mapa.

## Comunicación y comprobaciones

Se reutilizan `/commands` y `/logs` del bridge autenticado existente. El evento
`spb:pvp_admin` sólo acepta el origen Server. Los mensajes se fragmentan,
correlacionan y codifican para mantener el límite de 512 caracteres del bridge.
La API no confirma un cambio hasta recibir la respuesta del add-on.

Validación local:

```powershell
npm run typecheck
node --experimental-vm-modules tools/test-pvp-arenas.mjs
cd dashboard
npm run check
npm run build
```

La prueba del protocolo en VM se ejecuta con
`sudo python3 /tmp/spb-probe-pvp-arenas.py staging --exercise-staging`.
Crea y elimina un borrador temporal, comprueba revisión antigua y rechazo por
falta de suelo. No coloca bloques ni NPCs. En Producción sólo se permite la
consulta con `production`, sin `--exercise-staging`.

El verificador del dashboard presenta errores existentes fuera del módulo PvP.
Se corrigieron su alias `#lib` y el chequeo accidental del JavaScript generado;
esto no cambia la compilación ni omite la comprobación de TypeScript/Svelte.
