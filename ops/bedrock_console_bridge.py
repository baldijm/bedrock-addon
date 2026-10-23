#!/usr/bin/env python3
"""Private, local console bridge for a Bedrock Dedicated Server.

The bridge is intended to be the direct child of systemd.  It owns the
bedrock_server process and its stdin/stdout while exposing a small, token
protected HTTP API on loopback only.  It is not an Internet-facing service.
"""

from __future__ import annotations

import argparse
import hmac
import json
import os
import signal
import subprocess
import sys
import threading
import time
import uuid
from collections import deque
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse


MAX_COMMAND_LENGTH = 512
MAX_BODY_BYTES = 16 * 1024
MAX_LOG_LINES = 500


def validate_command(value: object) -> str:
    """Return a safe single console line or raise ValueError."""
    if not isinstance(value, str):
        raise ValueError("El comando debe ser texto.")
    command = value.strip().lstrip("/")
    if not command or len(command) > MAX_COMMAND_LENGTH or any(
        char in command for char in ("\r", "\n", "\0")
    ):
        raise ValueError("El comando debe ocupar una sola línea de hasta 512 caracteres.")
    return command


class OutputBuffer:
    """Small, ordered in-memory view of the real BDS console output."""

    def __init__(self, limit: int = MAX_LOG_LINES) -> None:
        self._lines: deque[dict[str, Any]] = deque(maxlen=limit)
        self._next_id = 1
        self._lock = threading.Lock()

    def append(self, text: str) -> int:
        with self._lock:
            line_id = self._next_id
            self._next_id += 1
            self._lines.append(
                {
                    "id": line_id,
                    "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "text": text,
                }
            )
            return line_id

    def after(self, after_id: int) -> tuple[list[dict[str, Any]], int]:
        with self._lock:
            lines = [line for line in self._lines if line["id"] > after_id]
            return lines, self._next_id - 1


class BedrockConsoleBridge:
    def __init__(self, root: Path, output: OutputBuffer) -> None:
        self.root = root
        self.output = output
        self.process: subprocess.Popen[str] | None = None
        self._stdin_lock = threading.Lock()
        self._stop_requested = False

    def start(self) -> None:
        executable = self.root / "bedrock_server"
        if not executable.is_file():
            raise RuntimeError(f"No existe el ejecutable esperado: {executable}")

        environment = os.environ.copy()
        environment["LD_LIBRARY_PATH"] = str(self.root)
        self.process = subprocess.Popen(
            [str(executable)],
            cwd=self.root,
            env=environment,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        threading.Thread(target=self._read_output, name="bedrock-console-output", daemon=True).start()

    def _read_output(self) -> None:
        assert self.process is not None and self.process.stdout is not None
        for line in self.process.stdout:
            text = line.rstrip("\r\n")
            self.output.append(text)
            print(text, flush=True)

    def is_running(self) -> bool:
        return self.process is not None and self.process.poll() is None

    def submit(self, command: str) -> tuple[str, int]:
        if not self.is_running() or self.process is None or self.process.stdin is None:
            raise RuntimeError("Bedrock no está en ejecución.")
        command_id = str(uuid.uuid4())
        with self._stdin_lock:
            self.process.stdin.write(command + "\n")
            self.process.stdin.flush()
        _, cursor = self.output.after(0)
        return command_id, cursor

    def request_stop(self, wait_seconds: int = 60) -> None:
        if not self.is_running() or self.process is None:
            return
        if not self._stop_requested:
            self._stop_requested = True
            try:
                self.submit("stop")
            except (BrokenPipeError, RuntimeError):
                return
        try:
            self.process.wait(timeout=wait_seconds)
        except subprocess.TimeoutExpired:
            self.process.terminate()
            try:
                self.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.process.kill()


class BridgeRequestHandler(BaseHTTPRequestHandler):
    server_version = "SPBBedrockBridge/1"

    @property
    def bridge_server(self) -> "BridgeHTTPServer":
        return self.server  # type: ignore[return-value]

    def log_message(self, format: str, *args: object) -> None:
        # Keep the journal useful without echoing token-bearing request headers.
        print("bridge-http " + (format % args), flush=True)

    def _send_json(self, status: HTTPStatus, body: dict[str, Any]) -> None:
        encoded = json.dumps(body, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def _authorized(self) -> bool:
        given = self.headers.get("Authorization", "")
        expected = self.bridge_server.token
        return len(given) == len(expected) and hmac.compare_digest(given, expected)

    def _require_authorization(self) -> bool:
        if self._authorized():
            return True
        self._send_json(HTTPStatus.UNAUTHORIZED, {"error": "No autorizado."})
        return False

    def do_GET(self) -> None:  # noqa: N802
        if not self._require_authorization():
            return
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            self._send_json(
                HTTPStatus.OK,
                {"ok": True, "bedrockRunning": self.bridge_server.bridge.is_running()},
            )
            return
        if parsed.path == "/logs":
            query = parse_qs(parsed.query)
            try:
                after_id = max(0, int(query.get("after", ["0"])[0]))
            except ValueError:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Cursor inválido."})
                return
            lines, cursor = self.bridge_server.output.after(after_id)
            self._send_json(HTTPStatus.OK, {"lines": lines, "cursor": cursor})
            return
        self._send_json(HTTPStatus.NOT_FOUND, {"error": "No existe esa ruta."})

    def do_POST(self) -> None:  # noqa: N802
        if not self._require_authorization():
            return
        if urlparse(self.path).path != "/commands":
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "No existe esa ruta."})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length < 1 or length > MAX_BODY_BYTES:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Cuerpo inválido."})
            return
        try:
            body = json.loads(self.rfile.read(length))
            command = validate_command(body.get("command"))
            command_id, cursor = self.bridge_server.bridge.submit(command)
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            return
        except RuntimeError as error:
            self._send_json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": str(error)})
            return
        self._send_json(
            HTTPStatus.ACCEPTED,
            {"id": command_id, "status": "accepted", "outputCursor": cursor},
        )


class BridgeHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(
        self, address: tuple[str, int], bridge: BedrockConsoleBridge, token: str, output: OutputBuffer
    ) -> None:
        super().__init__(address, BridgeRequestHandler)
        self.bridge = bridge
        self.token = token
        self.output = output


def parse_address(value: str) -> tuple[str, int]:
    host, separator, port_text = value.rpartition(":")
    if not separator or not host:
        raise argparse.ArgumentTypeError("Usa HOST:PUERTO.")
    try:
        port = int(port_text)
    except ValueError as error:
        raise argparse.ArgumentTypeError("El puerto debe ser numérico.") from error
    if host != "127.0.0.1" or not 1 <= port <= 65535:
        raise argparse.ArgumentTypeError("El bridge sólo puede escuchar en 127.0.0.1:PUERTO.")
    return host, port


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("--listen", required=True, type=parse_address)
    arguments = parser.parse_args()

    token = os.environ.get("SPB_BRIDGE_TOKEN", "")
    if len(token) < 32:
        raise RuntimeError("Falta SPB_BRIDGE_TOKEN o no tiene la longitud mínima.")

    output = OutputBuffer()
    bridge = BedrockConsoleBridge(arguments.root, output)
    bridge.start()
    server = BridgeHTTPServer(arguments.listen, bridge, token, output)

    def stop(_signum: int, _frame: object) -> None:
        threading.Thread(target=server.shutdown, name="bridge-shutdown", daemon=True).start()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    watcher = threading.Thread(target=lambda: (bridge.process.wait(), server.shutdown()), daemon=True)
    watcher.start()
    try:
        server.serve_forever(poll_interval=0.5)
    finally:
        server.server_close()
        bridge.request_stop()
    return bridge.process.returncode if bridge.process and bridge.process.returncode is not None else 1


if __name__ == "__main__":
    sys.exit(main())
