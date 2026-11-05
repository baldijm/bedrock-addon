const http = require('node:http');
const fs = require('node:fs');
const crypto = require('node:crypto');

const tokenFile = process.env.BEDROCK_API_TOKEN_FILE;
if (!tokenFile) {
  throw new Error('BEDROCK_API_TOKEN_FILE debe apuntar al archivo privado del token');
}

const API_TOKEN = fs.readFileSync(tokenFile, 'utf8').trim();
if (!API_TOKEN) {
  throw new Error('El archivo del token está vacío');
}

function authorized(req) {
  const supplied = req.headers['x-api-token'];

  if (typeof supplied !== 'string') return false;

  const expected = Buffer.from(API_TOKEN, 'utf8');
  const received = Buffer.from(supplied, 'utf8');

  return expected.length === received.length &&
    crypto.timingSafeEqual(expected, received);
}

const HOST = '127.0.0.1';
const PORT = Number(process.env.BEDROCK_API_PORT || 3000);
const MAX_BODY_BYTES = 4096;

function sendJSON(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8'
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    sendJSON(res, 200, {
      status: 'ok',
      service: 'bedrock-api',
      timestamp: new Date().toISOString()
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/spb/test') {
    if (!authorized(req)) {
      sendJSON(res, 401, { error: 'No autorizado' });
      return;
    }

    let body = '';
    let bytes = 0;
    let rejected = false;

    req.on('data', chunk => {
      if (rejected) return;

      bytes += chunk.length;

      if (bytes > MAX_BODY_BYTES) {
        rejected = true;
        sendJSON(res, 413, { error: 'Solicitud demasiado grande' });
        req.resume();
        return;
      }

      body += chunk.toString('utf8');
    });

    req.on('end', () => {
      if (rejected) return;

      let data;

      try {
        data = JSON.parse(body);
      } catch {
        sendJSON(res, 400, { error: 'JSON invalido' });
        return;
      }

      if (
        !data ||
        typeof data !== 'object' ||
        Array.isArray(data) ||
        data.source !== 'minecraft' ||
        typeof data.message !== 'string' ||
        data.message.length > 200
      ) {
        sendJSON(res, 400, { error: 'Datos invalidos' });
        return;
      }

      console.log('[SPB TEST] Mensaje recibido desde Minecraft');

      sendJSON(res, 200, {
        success: true,
        received: true,
        message: 'Datos recibidos correctamente',
        timestamp: new Date().toISOString()
      });
    });

    req.on('error', () => {
      if (!res.headersSent) {
        sendJSON(res, 400, { error: 'Error al leer la solicitud' });
      }
    });

    return;
  }

  sendJSON(res, 404, { error: 'Ruta no encontrada' });
});

server.listen(PORT, HOST, () => {
  console.log(`API escuchando en http://${HOST}:${server.address().port}`);
});
