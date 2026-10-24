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
import re
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
PLAYER_LIST_TIMEOUT_SECONDS = 2
SERVER_PROPERTIES_FILE = "server.properties"
WORLD_RESET_REQUESTS = Path("/var/lib/spb/staging-world-reset/requests")
WORLD_RESET_STATUS = Path("/var/lib/spb/staging-world-reset/status.json")
WORLD_RESET_UNIT_PREFIX = "spb-staging-world-reset@"
SERVER_PROPERTY_SPECS: dict[str, tuple[str, int | None, int | None, set[str] | None]] = {
    "server-name": ("text", None, None, None),
    "level-name": ("level", None, None, None),
    "level-seed": ("text", None, None, None),
    "gamemode": ("choice", None, None, {"survival", "creative", "adventure"}),
    "difficulty": ("choice", None, None, {"peaceful", "easy", "normal", "hard"}),
    "max-players": ("integer", 1, 100, None),
    "view-distance": ("integer", 5, 32, None),
    "tick-distance": ("integer", 4, 12, None),
    "allow-cheats": ("boolean", None, None, None),
    "allow-list": ("boolean", None, None, None),
    "default-player-permission-level": ("choice", None, None, {"visitor", "member", "operator"}),
    "player-idle-timeout": ("integer", 0, 1440, None),
}
PLAYER_LIST_PATTERN = re.compile(
    r"There are (?P<online>\d+)\s*/\s*(?P<capacity>\d+) players online:\s*(?P<names>.*)",
    re.IGNORECASE,
)


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


def parse_server_properties(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key] = value
    return values


def validate_property_value(key: str, value: object) -> str:
    spec = SERVER_PROPERTY_SPECS.get(key)
    if spec is None:
        raise ValueError(f"La propiedad {key!r} no se puede modificar desde el panel.")
    kind, minimum, maximum, choices = spec
    if kind == "boolean":
        if not isinstance(value, bool):
            raise ValueError(f"{key} debe ser verdadero o falso.")
        return "true" if value else "false"
    if kind == "integer":
        if not isinstance(value, int) or isinstance(value, bool) or minimum is None or maximum is None:
            raise ValueError(f"{key} debe ser un número entero.")
        if not minimum <= value <= maximum:
            raise ValueError(f"{key} debe estar entre {minimum} y {maximum}.")
        return str(value)
    if not isinstance(value, str):
        raise ValueError(f"{key} debe ser texto.")
    normalized = value.strip()
    if kind == "choice":
        if normalized not in (choices or set()):
            raise ValueError(f"Valor inválido para {key}.")
        return normalized
    if key == "level-seed" and not normalized:
        return ""
    if not normalized or len(normalized) > 64 or any(char in normalized for char in ("\r", "\n", "\0")):
        raise ValueError(f"{key} debe tener entre 1 y 64 caracteres en una sola línea.")
    if kind == "level" and ("/" in normalized or "\\" in normalized or normalized in {".", ".."}):
        raise ValueError("El nombre del mundo no puede contener rutas.")
    return normalized


def update_server_properties(path: Path, updates: dict[str, object]) -> dict[str, str]:
    if not isinstance(updates, dict) or not updates:
        raise ValueError("No hay propiedades para actualizar.")
    validated = {key: validate_property_value(key, value) for key, value in updates.items()}
    original = path.read_text(encoding="utf-8")
    existing = parse_server_properties(path)
    changed = {key: value for key, value in validated.items() if existing.get(key) != value}
    if not changed:
        return {}

    remaining = set(changed)
    output: list[str] = []
    for line in original.splitlines():
        if not line or line.startswith("#") or "=" not in line:
            output.append(line)
            continue
        key, _ = line.split("=", 1)
        if key in changed:
            output.append(f"{key}={changed[key]}")
            remaining.discard(key)
        else:
            output.append(line)
    output.extend(f"{key}={changed[key]}" for key in sorted(remaining))

    backup = path.with_name(f"{path.name}.dashboard-backup-{int(time.time())}")
    backup.write_text(original, encoding="utf-8")
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        temporary.write_text("\n".join(output) + "\n", encoding="utf-8")
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
    return changed


def validate_world_reset_request(root: Path, value: object) -> dict[str, str]:
    if not isinstance(value, dict):
        raise ValueError("Solicitud de mundo inválida.")
    mode = value.get("mode")
    confirmation = value.get("confirmation")
    seed = value.get("seed", "")
    current = parse_server_properties(root / SERVER_PROPERTIES_FILE).get("level-name", "")
    if not current or confirmation != current:
        raise ValueError("Escribe exactamente el nombre del mundo actual para confirmar.")
    if mode not in {"random", "seed"}:
        raise ValueError("Elige seed aleatoria o seed personalizada.")
    if not isinstance(seed, str) or len(seed) > 64 or any(char in seed for char in ("\r", "\n", "\0")):
        raise ValueError("La seed no es válida.")
    if mode == "seed" and not seed.strip():
        raise ValueError("Escribe una seed para crear el mundo.")
    return {"mode": mode, "seed": seed.strip() if mode == "seed" else "", "world": current}


def request_world_reset(root: Path, value: object) -> str:
    request = validate_world_reset_request(root, value)
    if root != Path("/opt/bedrock-staging"):
        raise RuntimeError("El reinicio de mundos sólo está habilitado para staging.")
    if not WORLD_RESET_REQUESTS.is_dir() or WORLD_RESET_REQUESTS.is_symlink():
        raise RuntimeError("El servicio de reinicio de mundos no está instalado.")
    operation = uuid.uuid4().hex
    payload = {"id": operation, **request, "requestedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    path = WORLD_RESET_REQUESTS / f"{operation}.json"
    path.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    try:
        subprocess.run(
            ["sudo", "/bin/systemctl", "start", f"{WORLD_RESET_UNIT_PREFIX}{operation}.service"],
            check=True,
            timeout=10,
            capture_output=True,
            text=True,
        )
    except (subprocess.SubprocessError, OSError) as error:
        path.unlink(missing_ok=True)
        raise RuntimeError("No se pudo iniciar el reinicio de mundo de staging.") from error
    return operation


def read_world_reset_status() -> dict[str, Any]:
    if not WORLD_RESET_STATUS.is_file() or WORLD_RESET_STATUS.is_symlink():
        return {"state": "idle"}
    try:
        value = json.loads(WORLD_RESET_STATUS.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"state": "unknown"}
    return value if isinstance(value, dict) else {"state": "unknown"}


class OutputBuffer:
    """Small, ordered in-memory view of the real BDS console output."""

    def __init__(self, limit: int = MAX_LOG_LINES) -> None:
        self._lines: deque[dict[str, Any]] = deque(maxlen=limit)
        self._next_id = 1
        self._lock = threading.Lock()
        self._updated = threading.Condition(self._lock)

    def append(self, text: str) -> int:
        with self._updated:
            line_id = self._next_id
            self._next_id += 1
            self._lines.append(
                {
                    "id": line_id,
                    "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "text": text,
                }
            )
            self._updated.notify_all()
            return line_id

    def after(self, after_id: int) -> tuple[list[dict[str, Any]], int]:
        with self._lock:
            lines = [line for line in self._lines if line["id"] > after_id]
            return lines, self._next_id - 1

    def wait_after(self, after_id: int, timeout_seconds: float) -> list[dict[str, Any]]:
        """Wait briefly for server output emitted after a console command."""
        deadline = time.monotonic() + timeout_seconds
        with self._updated:
            while self._next_id - 1 <= after_id:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return []
                self._updated.wait(remaining)
            return [line for line in self._lines if line["id"] > after_id]


class BedrockConsoleBridge:
    def __init__(self, root: Path, output: OutputBuffer) -> None:
        self.root = root
        self.output = output
        self.active_properties: dict[str, str] = {}
        self.process: subprocess.Popen[str] | None = None
        self._stdin_lock = threading.Lock()
        self._query_lock = threading.Lock()
        self._stop_requested = False

    def start(self) -> None:
        executable = self.root / "bedrock_server"
        if not executable.is_file():
            raise RuntimeError(f"No existe el ejecutable esperado: {executable}")
        # Snapshot before starting BDS: this is the configuration currently in use.
        self.active_properties = parse_server_properties(self.root / SERVER_PROPERTIES_FILE)

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
            _, cursor = self.output.after(0)
            self.process.stdin.write(command + "\n")
            self.process.stdin.flush()
        return command_id, cursor

    def list_players(self) -> dict[str, Any]:
        """Return only the current BDS `list` response, never a cached estimate."""
        with self._query_lock:
            _, cursor = self.submit("list")
            deadline = time.monotonic() + PLAYER_LIST_TIMEOUT_SECONDS
            pending_count: tuple[int, int, str] | None = None
            while remaining := deadline - time.monotonic():
                lines = self.output.wait_after(cursor, remaining)
                if not lines:
                    break
                cursor = lines[-1]["id"]
                for line in lines:
                    match = PLAYER_LIST_PATTERN.search(line["text"])
                    if match:
                        names_text = match.group("names").strip()
                        online = int(match.group("online"))
                        capacity = int(match.group("capacity"))
                        if names_text or online == 0:
                            names = [name.strip() for name in names_text.split(",") if name.strip()]
                            return {
                                "online": online,
                                "capacity": capacity,
                                "players": names,
                                "observedAt": line["at"],
                                "source": "bedrock-list",
                            }
                        # Recent Bedrock builds print player names on the following line.
                        pending_count = (online, capacity, line["at"])
                        continue
                    if pending_count is not None:
                        names = [name.strip() for name in line["text"].split(",") if name.strip()]
                        if names:
                            online, capacity, observed_at = pending_count
                            return {
                                "online": online,
                                "capacity": capacity,
                                "players": names,
                                "observedAt": observed_at,
                                "source": "bedrock-list",
                            }
        raise RuntimeError("Bedrock no devolvió una respuesta reconocible al comando list.")

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
        if parsed.path == "/players":
            try:
                self._send_json(HTTPStatus.OK, self.bridge_server.bridge.list_players())
            except RuntimeError as error:
                self._send_json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": str(error)})
            return
        if parsed.path == "/properties":
            try:
                values = parse_server_properties(self.bridge_server.bridge.root / SERVER_PROPERTIES_FILE)
            except OSError as error:
                self._send_json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": str(error)})
                return
            self._send_json(
                HTTPStatus.OK,
                {
                    "environment": "staging",
                    "properties": {key: values.get(key, "") for key in SERVER_PROPERTY_SPECS},
                    "activeProperties": {
                        key: self.bridge_server.bridge.active_properties.get(key, "")
                        for key in SERVER_PROPERTY_SPECS
                    },
                    "hasPendingChanges": any(
                        values.get(key, "") != self.bridge_server.bridge.active_properties.get(key, "")
                        for key in SERVER_PROPERTY_SPECS
                    ),
                    "restartRequired": True,
                },
            )
            return
        if parsed.path == "/world/reset/status":
            self._send_json(HTTPStatus.OK, read_world_reset_status())
            return
        if parsed.path == "/properties/cancel":
            try:
                changed = update_server_properties(
                    self.bridge_server.bridge.root / SERVER_PROPERTIES_FILE,
                    {
                        key: self.bridge_server.bridge.active_properties.get(key, "")
                        for key in SERVER_PROPERTY_SPECS
                    },
                )
            except (OSError, ValueError) as error:
                self._send_json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": str(error)})
                return
            self._send_json(
                HTTPStatus.OK,
                {"ok": True, "environment": "staging", "changed": changed, "restartRequired": False},
            )
            return
        self._send_json(HTTPStatus.NOT_FOUND, {"error": "No existe esa ruta."})

    def do_POST(self) -> None:  # noqa: N802
        if not self._require_authorization():
            return
        path = urlparse(self.path).path
        if path not in {"/commands", "/properties", "/world/reset"}:
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
            if path == "/world/reset":
                operation = request_world_reset(self.bridge_server.bridge.root, body)
                self._send_json(HTTPStatus.ACCEPTED, {"ok": True, "environment": "staging", "operation": operation})
                return
            if path == "/properties":
                changed = update_server_properties(
                    self.bridge_server.bridge.root / SERVER_PROPERTIES_FILE,
                    body.get("properties"),
                )
                self._send_json(
                    HTTPStatus.OK,
                    {
                        "ok": True,
                        "environment": "staging",
                        "changed": changed,
                        "restartRequired": bool(changed),
                        "message": "Guardado en staging. Reinicia staging para aplicar las propiedades del servidor.",
                    },
                )
                return
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
