# API local de SPB

Este servicio corresponde a la API HTTP que actualmente funciona en Azure. La ruta `/spb/test` recibe el mensaje del paquete experimental de Minecraft. `/health` confirma que la API responde; no prueba por sí sola la salud del servidor Bedrock.

## Inicio en otro proveedor

Requisitos: Node.js y un archivo privado con el mismo token configurado como secreto `SPB_API_TOKEN` en Minecraft. El archivo del token se crea fuera del repositorio, con acceso únicamente para el usuario del servicio (por ejemplo, modo `600`). No se copia el token a GitHub ni a los respaldos de mundos.

Defina `BEDROCK_API_TOKEN_FILE` con la ruta absoluta de ese archivo y ejecute `node services/bedrock-api/server.js` desde la copia del repositorio. Opcionalmente, `BEDROCK_API_PORT` cambia el puerto; el valor predeterminado es `3000`. La API escucha solo en `127.0.0.1`, igual que la instalación actual. El paquete experimental apunta a `http://127.0.0.1:3000/spb/test`; si cambia el puerto, actualice y pruebe también el paquete.

Para migrar, aprovisione un servicio que ejecute este archivo desde un commit fijado de GitHub, suministre el token por un canal seguro y compruebe `/health` y una solicitud autenticada a `/spb/test`. La configuración del servicio de sistema debe ajustarse al usuario y la ruta de cada proveedor. El servicio en producción de Azure todavía ejecuta `/home/azureuser/bedrock-api/server.js`; incorporar este archivo al repositorio no lo sustituye automáticamente.
