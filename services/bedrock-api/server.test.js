const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

test('la API responde y protege la ruta de Minecraft', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bedrock-api-test-'));
  const tokenFile = path.join(directory, 'token');
  const token = 'token-exclusivo-de-prueba';
  fs.writeFileSync(tokenFile, token, { mode: 0o600 });

  const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: {
      ...process.env,
      BEDROCK_API_TOKEN_FILE: tokenFile,
      BEDROCK_API_PORT: '0'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    const port = await new Promise((resolve, reject) => {
      let output = '';
      const timeout = setTimeout(() => reject(new Error('La API no inició')), 5000);
      child.stdout.on('data', chunk => {
        output += chunk.toString();
        const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
        if (match) {
          clearTimeout(timeout);
          resolve(Number(match[1]));
        }
      });
      child.once('error', error => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once('exit', code => {
        clearTimeout(timeout);
        reject(new Error(`La API terminó antes de iniciar (${code})`));
      });
    });

    const url = `http://127.0.0.1:${port}`;
    const health = await fetch(`${url}/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).service, 'bedrock-api');

    const payload = JSON.stringify({ source: 'minecraft', message: 'prueba' });
    const unauthorized = await fetch(`${url}/spb/test`, {
      method: 'POST',
      body: payload
    });
    assert.equal(unauthorized.status, 401);

    const authorized = await fetch(`${url}/spb/test`, {
      method: 'POST',
      headers: { 'x-api-token': token },
      body: payload
    });
    assert.equal(authorized.status, 200);
    assert.equal((await authorized.json()).received, true);
  } finally {
    child.kill();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
