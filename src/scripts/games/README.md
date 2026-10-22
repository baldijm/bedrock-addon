# Juegos

Cada minijuego nuevo vive en su propia carpeta aquí. Por ejemplo:

```text
games/
  parkour/
    index.ts       # registro y ciclo de vida del juego
    config.ts      # reglas y ajustes propios
    rewards.ts     # recompensas del juego (usa global/recompensas)
    ui.ts          # menús exclusivos del juego, si los necesita
```

Los sistemas compartidos no van dentro de un juego: usa `global/` para economía,
ranking, recompensas y configuración; y `features/` para mecánicas generales del
servidor. Cuando se cree el primer juego, `core/bootstrap.ts` será el único lugar
que deberá importarlo para registrarlo.
