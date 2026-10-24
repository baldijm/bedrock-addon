#!/usr/bin/env python3
"""Read-only HTTP observer for the production Bedrock systemd service."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hmac
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import subprocess
from urllib.parse import urlparse


SERVICE = "bedrock.service"
MAX_LOG_LINES = 300


def parse_address(value: str) -> tuple[str, int]:
    host, separator, port_text = value.rpartition(":")
    if not separator or host not in {"127.0.0.1", "::1"}:
        raise argparse.ArgumentTypeError("Usa una dirección loopback, por ejemplo 127.0.0.1:3003")
    try:
        port = int(port_text)
    except ValueError as error:
        raise argparse.ArgumentTypeError("El puerto no es válido") from error
    if not 1 <= port <= 65535:
        raise argparse.ArgumentTypeError("El puerto no es válido")
    return host, port


def journal_lines() -> list[dict[str, object]]:
    result = subprocess.run(
        ["journalctl", "--unit", SERVICE, "--no-pager", "--output=json", "-n", str(MAX_LOG_LINES)],
        check=True,
        text=True,
        capture_output=True,
        timeout=15,
    )
    lines: list[dict[str, object]] = []
    for index, raw in enumerate(result.stdout.splitlines(), start=1):
        try:
            entry = json.loads(raw)
            timestamp = int(entry.get("__REALTIME_TIMESTAMP", 0))
            message = entry.get("MESSAGE", "")
        except (TypeError, ValueError, json.JSONDecodeError):
            continue
        if not isinstance(message, str) or timestamp <= 0:
            continue
        at = datetime.fromtimestamp(timestamp / 1_000_000, timezone.utc).isoformat().replace("+00:00", "Z")
        lines.append({"id": index, "at": at, "text": message})
    return lines


def bedrock_running() -> bool:
    return subprocess.run(
        ["systemctl", "is-active", "--quiet", SERVICE], check=False, timeout=10
    ).returncode == 0


class ObserverHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address: tuple[str, int], token: str):
        super().__init__(address, ObserverRequestHandler)
        self.token = token


class ObserverRequestHandler(BaseHTTPRequestHandler):
    server: ObserverHTTPServer

    def log_message(self, _format: str, *_args: object) -> None:
        return

    def send_json(self, status: HTTPStatus, payload: object) -> None:
        encoded = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def authorized(self) -> bool:
        given = self.headers.get("Authorization", "")
        expected = self.server.token
        return len(given) == len(expected) and hmac.compare_digest(given, expected)

    def do_GET(self) -> None:  # noqa: N802
        if not self.authorized():
            self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "No autorizado."})
            return
        path = urlparse(self.path).path
        if path == "/health":
            self.send_json(
                HTTPStatus.OK,
                {"environment": "production", "bedrockRunning": bedrock_running(), "readOnly": True},
            )
            return
        if path == "/logs":
            lines = journal_lines()
            self.send_json(HTTPStatus.OK, {"lines": lines, "cursor": len(lines)})
            return
        self.send_json(HTTPStatus.NOT_FOUND, {"error": "No existe esa ruta."})

    def do_POST(self) -> None:  # noqa: N802
        self.send_json(HTTPStatus.METHOD_NOT_ALLOWED, {"error": "Producción está disponible sólo en lectura."})


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--listen", required=True, type=parse_address)
    arguments = parser.parse_args()
    token = os.environ.get("SPB_PRODUCTION_OBSERVER_TOKEN", "")
    if len(token) < 32:
        raise RuntimeError("Falta SPB_PRODUCTION_OBSERVER_TOKEN o no tiene la longitud mínima.")
    ObserverHTTPServer(arguments.listen, token).serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
