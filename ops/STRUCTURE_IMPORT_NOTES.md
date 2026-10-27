# Importación de estructuras desde R2

El cuerpo HTTP debe leerse exactamente hasta Content-Length. Una lectura adicional
bloquea la conexión persistente y retrasa la respuesta hasta que el cliente cierra.

Las plantillas externas se instalan en behavior_packs/SPB_BP/structures/spb,
con permiso de escritura para bedrock en ese directorio. Una carpeta structures
junto a la base de datos del mundo no registra plantillas en Bedrock.

## Limitación comprobada en staging

Bedrock indexa las plantillas del pack al arrancar. Agregar un archivo nuevo durante
la ejecución no permite cargarlo inmediatamente; reload recarga funciones y scripts,
pero no registra esa plantilla. Tras instalar una plantilla nueva hace falta reiniciar
staging antes de colocarla. No reiniciar producción automáticamente por esta operación.

Verificación del 27 de octubre de 2026: finn respondió a la importación local en
aproximadamente un segundo (6 297 433 bytes). Tras reiniciar staging, Bedrock reconoció
spb:finn; la prueba con integridad cero quedó en cola esperando chunks. Eso confirma
el reconocimiento, pero no demuestra una colocación completa desde el dashboard.
