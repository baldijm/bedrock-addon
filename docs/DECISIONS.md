# Decisiones relevantes

## Biblioteca R2 y activación fragmentada

La biblioteca de estructuras se almacena de forma privada en R2 y conserva sus
metadatos en D1. Para activarla en Staging, el Worker reenvía los binarios al
bridge local. La transferencia se divide en partes de 10 MiB y cada parte usa
una invocación del Worker distinta. Esto evita el límite de subrequests de
Cloudflare y permite mostrar avance real al administrador.

## Separación de entornos

Staging usa su propio directorio, servicio y puerto `19134`; Producción usa
`19132`. Las pruebas de add-on, estructuras y protecciones se realizan primero
en Staging. Una corrección de Staging no autoriza cambios homólogos en
Producción.

## Información visible durante operaciones largas

Las operaciones prolongadas deben comunicar fase y evidencia: archivo actual,
bytes, resultado de bridge y reinicio si corresponde. Un botón bloqueado con
“Procesando” no es suficiente para distinguir progreso de un bloqueo.
