"use strict";

const crypto = require("crypto");
const http = require("http");

const host = process.env.SPB_STAGING_API_HOST || "127.0.0.1";
const port = Number(process.env.SPB_STAGING_API_PORT || "3001");
const token = process.env.SPB_STAGING_API_TOKEN;
const maxBodyBytes = 16 * 1024;

if (!token || !Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("Falta configuración segura de la API de staging");
}

function hasValidToken(value) {
  const received = Buffer.from(value || "", "utf8");
  const expected = Buffer.from(token, "utf8");
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

function send(response, status, body) {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

const server = http.createServer((request, response) => {
  if (request.method !== "POST" || request.url !== "/spb/test") {
    send(response, 404, { ok: false });
    return;
  }
  if (!hasValidToken(request.headers["x-api-token"])) {
    send(response, 401, { ok: false });
    return;
  }

  let bytes = 0;
  request.on("data", (chunk) => {
    bytes += chunk.length;
    if (bytes > maxBodyBytes) request.destroy();
  });
  request.on("end", () => {
    if (bytes > maxBodyBytes) return;
    // Intentionally stateless: this proves the integration without persisting
    // player or world data in an environment that is only for tests.
    console.log(JSON.stringify({ event: "spb_staging_request", bytes }));
    send(response, 200, { ok: true, environment: "staging" });
  });
});

server.listen(port, host, () => {
  console.log(`SPB staging API listening on ${host}:${port}`);
});
