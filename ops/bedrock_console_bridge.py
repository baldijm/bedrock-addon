#!/usr/bin/env python3
"""Private, local console bridge for a Bedrock Dedicated Server.

The bridge is intended to be the direct child of systemd.  It owns the
bedrock_server process and its stdin/stdout while exposing a small, token
protected HTTP API on loopback only.  It is not an Internet-facing service.
"""

from __future__ import annotations

import argparse
import base64
import hmac
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
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
STRUCTURE_COMMAND_TIMEOUT_SECONDS = 45
STRUCTURE_PLACEMENT_TIMEOUT_SECONDS = 90
STRUCTURE_EXTRACT_TIMEOUT_SECONDS = 90
MAX_STRUCTURE_BYTES = 20 * 1024 * 1024
MAX_IMPORTED_STRUCTURE_BYTES = 150 * 1024 * 1024
STRUCTURE_EXPORT_DIRECTORY = Path("/var/lib/spb/structure-exports")
SERVER_PROPERTIES_FILE = "server.properties"
WORLD_RESET_REQUESTS = Path("/var/lib/spb/staging-world-reset/requests")
WORLD_RESET_STATUS = Path("/var/lib/spb/staging-world-reset/status.json")
WORLD_RESET_UNIT_PREFIX = "spb-staging-world-reset@"
UPDATE_REQUESTS = Path("/var/lib/spb/bedrock-update/requests")
UPDATE_STATUS = Path("/var/lib/spb/bedrock-update/status")
UPDATE_UNIT_PREFIX = "spb-staging-bedrock-update@"
VERSION_LOG_PATTERN = re.compile(r"\bINFO\]\s+Version:\s*(?P<version>[0-9]+(?:\.[0-9]+){2,3})\b")
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
GAMERULE_PATTERNS = {
    "showcoordinates": re.compile(r"showcoordinates.*?\b(true|false)\b", re.IGNORECASE),
    "showdaysplayed": re.compile(r"showdaysplayed.*?\b(true|false)\b", re.IGNORECASE),
}
STRUCTURE_ID_PATTERN = re.compile(
    r"^(?P<namespace>[a-z0-9][a-z0-9_.-]{0,31}):(?P<name>[a-z0-9][a-z0-9_./-]{0,95})$"
)
STRUCTURE_LOADED_PATTERN = re.compile(r"Loaded a structure of name\s+(?P<identifier>[^\s]+)", re.IGNORECASE)


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


def validate_structure_id(value: object) -> tuple[str, str, str]:
    """Validate a Bedrock structure identifier without accepting filesystem paths."""
    if not isinstance(value, str):
        raise ValueError("El identificador de estructura debe ser texto.")
    identifier = value.strip().lower()
    match = STRUCTURE_ID_PATTERN.fullmatch(identifier)
    if not match or ".." in match.group("name") or match.group("name").startswith("/"):
        raise ValueError("Usa un identificador como mystructure:mi_casa, en minúsculas.")
    return identifier, match.group("namespace"), match.group("name")


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
            # El worker de reset detiene bedrock-staging, que también aloja este
            # bridge. No debemos esperar al oneshot: systemd acepta el trabajo y
            # devolvemos el ID antes de que el bridge se apague.
            ["sudo", "/bin/systemctl", "start", "--no-block", f"{WORLD_RESET_UNIT_PREFIX}{operation}.service"],
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


def environment_for_root(root: Path) -> str:
    return "production" if root == Path("/opt/bedrock") else "staging"


def read_update_status(root: Path, output: "OutputBuffer") -> dict[str, Any]:
    environment = environment_for_root(root)
    result: dict[str, Any] = {"environment": environment, "state": "idle"}
    version_file = root / ".spb-bedrock-version.json"
    try:
        stored = json.loads(version_file.read_text(encoding="utf-8"))
        if isinstance(stored, dict) and isinstance(stored.get("version"), str):
            result["installedVersion"] = stored["version"]
    except (OSError, json.JSONDecodeError):
        pass
    if "installedVersion" not in result:
        lines, _ = output.after(0)
        for line in reversed(lines):
            match = VERSION_LOG_PATTERN.search(str(line.get("text", "")))
            if match:
                result["installedVersion"] = match.group("version")
                break
    status_file = UPDATE_STATUS / f"{environment}.json"
    try:
        stored_status = json.loads(status_file.read_text(encoding="utf-8"))
        if isinstance(stored_status, dict):
            result.update(stored_status)
    except (OSError, json.JSONDecodeError):
        pass
    return result


def request_update(root: Path) -> dict[str, str]:
    environment = environment_for_root(root)
    if environment != "staging":
        raise RuntimeError("La actualización de producción requiere su canal de mantenimiento autorizado.")
    if not UPDATE_REQUESTS.is_dir() or UPDATE_REQUESTS.is_symlink():
        raise RuntimeError("El actualizador de Bedrock no está instalado.")
    current = read_update_status(root, OutputBuffer(limit=1))
    if current.get("state") in {"preparing", "downloading", "validating", "backing-up", "stopping", "installing", "starting"}:
        raise RuntimeError("Ya hay una actualización en curso.")
    operation = uuid.uuid4().hex
    request = UPDATE_REQUESTS / f"{operation}.json"
    request.write_text(json.dumps({"id": operation, "environment": environment}, separators=(",", ":")), encoding="utf-8")
    try:
        subprocess.run(
            ["sudo", "/bin/systemctl", "start", "--no-block", f"{UPDATE_UNIT_PREFIX}{operation}.service"],
            check=True,
            timeout=10,
            capture_output=True,
            text=True,
        )
    except (subprocess.SubprocessError, OSError) as error:
        request.unlink(missing_ok=True)
        raise RuntimeError("No se pudo iniciar la actualización de Bedrock.") from error
    return {"ok": "true", "environment": environment, "operation": operation}


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
    def __init__(self, root: Path, output: OutputBuffer, state_file: Path) -> None:
        self.root = root
        self.output = output
        self.state_file = state_file
        self.active_properties: dict[str, str] = {}
        self.process: subprocess.Popen[str] | None = None
        self._stdin_lock = threading.Lock()
        self._query_lock = threading.Lock()
        self._lifecycle_lock = threading.RLock()
        self._stop_requested = False
        self._desired_running = False
        self._shutdown_requested = False

    def start(self) -> None:
        with self._lifecycle_lock:
            self._desired_running = True
            if self.is_running() or self._shutdown_requested:
                return
            executable = self.root / "bedrock_server"
            if not executable.is_file():
                raise RuntimeError(f"No existe el ejecutable esperado: {executable}")
            # Snapshot before starting BDS: this is the configuration currently in use.
            self.active_properties = parse_server_properties(self.root / SERVER_PROPERTIES_FILE)

            environment = os.environ.copy()
            environment["LD_LIBRARY_PATH"] = str(self.root)
            process = subprocess.Popen(
                [str(executable)],
                cwd=self.root,
                env=environment,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )
            self.process = process
            self._stop_requested = False
            self.state_file.write_text(f"{process.pid}\n", encoding="ascii")
            threading.Thread(
                target=self._read_output,
                args=(process,),
                name="bedrock-console-output",
                daemon=True,
            ).start()
            threading.Thread(
                target=self._watch_process,
                args=(process,),
                name="bedrock-process-watcher",
                daemon=True,
            ).start()

    def _read_output(self, process: subprocess.Popen[str]) -> None:
        assert process.stdout is not None
        for line in process.stdout:
            text = line.rstrip("\r\n")
            self.output.append(text)
            print(text, flush=True)

    def _watch_process(self, process: subprocess.Popen[str]) -> None:
        process.wait()
        with self._lifecycle_lock:
            if self.process is not process:
                return
            self.state_file.unlink(missing_ok=True)
            should_restart = self._desired_running and not self._shutdown_requested
        if should_restart:
            while True:
                time.sleep(3)
                with self._lifecycle_lock:
                    if not self._desired_running or self._shutdown_requested:
                        return
                try:
                    self.start()
                    return
                except Exception as error:
                    print(f"No se pudo reiniciar Bedrock: {error}", file=sys.stderr, flush=True)

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

    def _command_output(self, command: str, timeout_seconds: float) -> list[dict[str, Any]]:
        """Issue one console command and retain only output emitted afterwards."""
        _, cursor = self.submit(command)
        lines = self.output.wait_after(cursor, timeout_seconds)
        return lines

    def _command_until(
        self, command: str, expected: re.Pattern[str], timeout_seconds: float
    ) -> list[dict[str, Any]]:
        """Wait for Bedrock's actual confirmation, ignoring unrelated log lines."""
        _, cursor = self.submit(command)
        deadline = time.monotonic() + timeout_seconds
        received: list[dict[str, Any]] = []
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise RuntimeError(f"Bedrock no confirmó {command!r} a tiempo.")
            lines = self.output.wait_after(cursor, remaining)
            if not lines:
                continue
            cursor = lines[-1]["id"]
            received.extend(lines)
            if command.startswith("structure load "):
                for line in lines:
                    text = str(line["text"])
                    if "can't be found" in text or "Can't load a structure" in text:
                        raise RuntimeError(text)
            if any(expected.search(str(line["text"])) for line in lines):
                return received

    def _command_until_result(
        self,
        command: str,
        success: re.Pattern[str],
        failure: re.Pattern[str],
        timeout_seconds: float,
    ) -> list[dict[str, Any]]:
        """Wait for a correlated success or error marker from the behavior pack."""
        _, cursor = self.submit(command)
        deadline = time.monotonic() + timeout_seconds
        received: list[dict[str, Any]] = []
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise RuntimeError("El addon no confirmó la colocación de la estructura a tiempo.")
            lines = self.output.wait_after(cursor, remaining)
            if not lines:
                continue
            cursor = lines[-1]["id"]
            received.extend(lines)
            for line in lines:
                text = str(line["text"])
                failed = failure.search(text)
                if failed:
                    detail = failed.groupdict().get("detail") or "El addon rechazó la colocación."
                    raise RuntimeError(detail.strip())
                if success.search(text):
                    return received

    def export_structure(self, source_id: object) -> dict[str, str | int]:
        """Extract one disk-saved structure from a short, held world snapshot.

        No original world file is edited.  Bedrock is asked to hold saves while
        its world directory is copied, and is always resumed in ``finally``.
        The temporary snapshot and extractor output are removed before return.
        """
        identifier, namespace, name = validate_structure_id(source_id)
        properties = parse_server_properties(self.root / SERVER_PROPERTIES_FILE)
        world_name = properties.get("level-name", "")
        if not world_name or world_name in {".", ".."} or "/" in world_name or "\\" in world_name:
            raise RuntimeError("El nombre del mundo activo no es válido.")
        world = self.root / "worlds" / world_name
        if world.is_symlink() or not world.is_dir() or not (world / "db").is_dir():
            raise RuntimeError("No se encontró el mundo activo para exportar la estructura.")
        tool = Path("/usr/local/lib/spb/structure-tools/node_modules/.bin/mcbe-structure-extract")
        if not tool.is_file():
            raise RuntimeError("El extractor de estructuras no está instalado todavía.")

        with self._query_lock:
            held = False
            if STRUCTURE_EXPORT_DIRECTORY.is_symlink() or not STRUCTURE_EXPORT_DIRECTORY.is_dir():
                raise RuntimeError("La carpeta temporal de estructuras no está disponible.")
            with tempfile.TemporaryDirectory(prefix="spb-structure-", dir=STRUCTURE_EXPORT_DIRECTORY) as temporary:
                temporary_root = Path(temporary)
                snapshot = temporary_root / "world"
                output = temporary_root / "output"
                try:
                    self._command_output("save hold", STRUCTURE_COMMAND_TIMEOUT_SECONDS)
                    held = True
                    # `save query` emits this exact BDS acknowledgement only when the
                    # held files are safe to copy.  It is the boundary, never a delay.
                    self._command_until(
                        "save query",
                        re.compile(r"Data saved\. Files are now ready to be copied\.", re.IGNORECASE),
                        STRUCTURE_COMMAND_TIMEOUT_SECONDS,
                    )
                    for path in world.rglob("*"):
                        if path.is_symlink():
                            raise RuntimeError("El mundo contiene un enlace simbólico no permitido.")
                    shutil.copytree(world, snapshot)
                finally:
                    if held:
                        try:
                            self._command_until(
                                "save resume",
                                re.compile(r"Changes to the world are resumed\.", re.IGNORECASE),
                                STRUCTURE_COMMAND_TIMEOUT_SECONDS,
                            )
                        except RuntimeError:
                            # The original command failure is more relevant; BDS will also
                            # resume writes when it stops, but this is logged for diagnosis.
                            print("No se pudo confirmar save resume tras exportar estructura.", file=sys.stderr, flush=True)

                try:
                    subprocess.run(
                        [str(tool), str(snapshot), "--output", str(output)],
                        check=True,
                        timeout=STRUCTURE_EXTRACT_TIMEOUT_SECONDS,
                        capture_output=True,
                        text=True,
                    )
                except (OSError, subprocess.SubprocessError) as error:
                    raise RuntimeError("No se pudo extraer la estructura desde la copia del mundo.") from error
                result = output / "structures" / namespace / f"{name}.mcstructure"
                if result.is_symlink() or not result.is_file():
                    raise RuntimeError("No se encontró una estructura guardada en disco con ese nombre.")
                size = result.stat().st_size
                if not 1 <= size <= MAX_STRUCTURE_BYTES:
                    raise RuntimeError("La estructura excede el límite seguro de 20 MiB.")
                encoded = base64.b64encode(result.read_bytes()).decode("ascii")
                return {"source": identifier, "size": size, "content": encoded}

    def import_structure(self, structure_id: object, stream: Any, size: int) -> dict[str, str | int]:
        """Atomically materialize a verified R2 structure in the active world's disk library.

        The private bridge accepts only its authenticated Worker.  It never follows
        links or lets the supplied Bedrock identifier escape the active world.
        """
        identifier, namespace, name = validate_structure_id(structure_id)
        if not 1 <= size <= MAX_IMPORTED_STRUCTURE_BYTES:
            raise ValueError("La estructura debe medir entre 1 byte y 150 MiB.")
        properties = parse_server_properties(self.root / SERVER_PROPERTIES_FILE)
        world_name = properties.get("level-name", "")
        if not world_name or world_name in {".", ".."} or "/" in world_name or "\\" in world_name:
            raise RuntimeError("El nombre del mundo activo no es válido.")
        world = self.root / "worlds" / world_name
        if world.is_symlink() or not world.is_dir() or not (world / "db").is_dir():
            raise RuntimeError("No se encontró el mundo activo para importar la estructura.")
        # BDS loads external .mcstructure templates from an active behavior pack,
        # not from an arbitrary directory beside the world's LevelDB database.
        structures = self.root / "behavior_packs" / "SPB_BP" / "structures"
        if structures.exists() and structures.is_symlink():
            raise RuntimeError("La carpeta de estructuras no es válida.")
        target_directory = structures / namespace
        target_directory.mkdir(mode=0o750, parents=True, exist_ok=True)
        if target_directory.is_symlink():
            raise RuntimeError("La carpeta de estructuras no es válida.")
        target = (target_directory / f"{name}.mcstructure").resolve()
        if target.parent != target_directory.resolve():
            raise ValueError("El identificador de estructura no es seguro.")
        written = 0
        temporary = target_directory / f".{name}.{uuid.uuid4().hex}.tmp"
        try:
            with temporary.open("xb") as output:
                while written < size:
                    chunk = stream.read(min(64 * 1024, size - written))
                    if not chunk:
                        raise ValueError("La carga de la estructura quedó incompleta.")
                    output.write(chunk)
                    written += len(chunk)
                # HTTP Content-Length delimits this body. Reading one more byte
                # waits for another request (or connection close) on keep-alive.
                output.flush()
                os.fsync(output.fileno())
            os.chmod(temporary, 0o640)
            os.replace(temporary, target)
        finally:
            temporary.unlink(missing_ok=True)
        return {"ok": True, "structure": identifier, "size": written}

    def materialized_structure(self, structure_id: object, expected_size: object) -> dict[str, str | int | bool]:
        """Confirm the exact local artifact after a streamed R2 upload.

        A tunnel can occasionally lose the response after the atomic replace has
        completed.  This read-only acknowledgement lets the Worker distinguish
        that completed write from a failed or partial upload.
        """
        identifier, namespace, name = validate_structure_id(structure_id)
        if not isinstance(expected_size, int) or isinstance(expected_size, bool) or expected_size < 1:
            raise ValueError("El tamaño esperado no es válido.")
        properties = parse_server_properties(self.root / SERVER_PROPERTIES_FILE)
        world_name = properties.get("level-name", "")
        if not world_name or world_name in {".", ".."} or "/" in world_name or "\\" in world_name:
            raise RuntimeError("El nombre del mundo activo no es válido.")
        directory = self.root / "behavior_packs" / "SPB_BP" / "structures" / namespace
        target = (directory / f"{name}.mcstructure").resolve()
        if target.parent != directory.resolve() or target.is_symlink() or not target.is_file():
            return {"ok": False, "structure": identifier}
        return {
            "ok": target.stat().st_size == expected_size,
            "structure": identifier,
            "size": target.stat().st_size,
        }

    def place_structure(self, request: object) -> dict[str, Any]:
        """Place a structure only after its complete horizontal footprint is ticking.

        Bedrock queues `structure load` when even one required chunk is absent.  A
        preloaded, uniquely named rectangle makes the loading boundary explicit;
        the HTTP call returns only after BDS emits its real load confirmation.
        """
        if not isinstance(request, dict):
            raise ValueError("Solicitud de colocación inválida.")
        identifier, _, _ = validate_structure_id(request.get("structure"))
        coordinates = tuple(request.get(axis) for axis in ("x", "y", "z"))
        if any(not isinstance(value, int) or isinstance(value, bool) for value in coordinates):
            raise ValueError("Las coordenadas de colocación deben ser enteros.")
        x, y, z = coordinates
        if any(value < -29_999_984 or value > 29_999_984 for value in coordinates):
            raise ValueError("Las coordenadas de colocación están fuera del mundo permitido.")
        dimensions = request.get("dimensions")
        if not isinstance(dimensions, dict):
            raise ValueError("Faltan las dimensiones verificadas de la estructura.")
        try:
            width, height, depth = (dimensions[key] for key in ("x", "y", "z"))
        except KeyError as error:
            raise ValueError("Las dimensiones verificadas están incompletas.") from error
        if any(not isinstance(value, int) or isinstance(value, bool) or not 1 <= value <= 2048 for value in (width, height, depth)):
            raise ValueError("Las dimensiones verificadas no son seguras.")
        rotation = request.get("rotation", "0_degrees")
        mirror = request.get("mirror", "none")
        mode = request.get("mode", "instant")
        include_air = request.get("includeAir", True)
        protect_blocks = request.get("protectBlocks", False)
        if rotation not in {"0_degrees", "90_degrees", "180_degrees", "270_degrees"}:
            raise ValueError("La rotación no es válida.")
        if mirror not in {"none", "x", "z", "xz"}:
            raise ValueError("El espejo no es válido.")
        if mode not in {"instant", "layers"}:
            raise ValueError("El modo de colocación no es válido.")
        if not isinstance(include_air, bool):
            raise ValueError("La opción de incluir aire no es válida.")
        if not isinstance(protect_blocks, bool):
            raise ValueError("La opción de proteger bloques no es válida.")

        corners = [(0, 0), (width - 1, 0), (0, depth - 1), (width - 1, depth - 1)]
        transformed: list[tuple[int, int]] = []
        for local_x, local_z in corners:
            if mirror in {"x", "xz"}:
                local_x = -local_x
            if mirror in {"z", "xz"}:
                local_z = -local_z
            if rotation == "90_degrees":
                local_x, local_z = -local_z, local_x
            elif rotation == "180_degrees":
                local_x, local_z = -local_x, -local_z
            elif rotation == "270_degrees":
                local_x, local_z = local_z, -local_x
            transformed.append((local_x, local_z))
        min_x = x + min(value[0] for value in transformed)
        max_x = x + max(value[0] for value in transformed)
        min_z = z + min(value[1] for value in transformed)
        max_z = z + max(value[1] for value in transformed)
        request_id = uuid.uuid4().hex[:12]
        payload = json.dumps(
            {
                "request": request_id,
                "structure": identifier,
                "x": x,
                "y": y,
                "z": z,
                "minX": min_x,
                "maxX": max_x,
                "minZ": min_z,
                "maxZ": max_z,
                "width": width,
                "height": height,
                "depth": depth,
                "rotation": rotation,
                "mirror": mirror,
                "mode": mode,
                "includeAir": include_air,
                "protectBlocks": protect_blocks,
            },
            separators=(",", ":"),
        )
        command = f"scriptevent spb:structure_place {payload}"
        success = re.compile(rf"SPB_STRUCTURE_PLACE\s+{request_id}\s+OK\b")
        failure = re.compile(
            rf"SPB_STRUCTURE_PLACE\s+{request_id}\s+(?:ERROR|UNCONFIRMED)(?:\s+(?P<detail>.*))?$"
        )
        with self._query_lock:
            self._command_until_result(
                command,
                success,
                failure,
                STRUCTURE_PLACEMENT_TIMEOUT_SECONDS,
            )
        return {
            "ok": True,
            "structure": identifier,
            "dimensions": {"x": width, "y": height, "z": depth},
            "area": {"from": {"x": min_x, "z": min_z}, "to": {"x": max_x, "z": max_z}},
        }

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

    def read_boolean_gamerule(self, name: str) -> bool:
        """Read a boolean gamerule from BDS instead of keeping a dashboard-side copy."""
        pattern = GAMERULE_PATTERNS.get(name)
        if pattern is None:
            raise ValueError("Gamerule no permitida.")
        with self._query_lock:
            _, cursor = self.submit(f"gamerule {name}")
            deadline = time.monotonic() + PLAYER_LIST_TIMEOUT_SECONDS
            while remaining := deadline - time.monotonic():
                lines = self.output.wait_after(cursor, remaining)
                if not lines:
                    break
                cursor = lines[-1]["id"]
                for line in lines:
                    match = pattern.search(line["text"])
                    if match:
                        return match.group(1).lower() == "true"
        raise RuntimeError(f"Bedrock no devolvió el estado de {name}.")

    def set_boolean_gamerule(self, name: str, value: bool) -> None:
        if name not in GAMERULE_PATTERNS:
            raise ValueError("Gamerule no permitida.")
        self.submit(f"gamerule {name} {'true' if value else 'false'}")

    def request_stop(self, wait_seconds: int = 60, *, keep_stopped: bool = False) -> None:
        if keep_stopped:
            with self._lifecycle_lock:
                self._desired_running = False
        if not self.is_running() or self.process is None:
            self.state_file.unlink(missing_ok=True)
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

    def shutdown(self) -> None:
        with self._lifecycle_lock:
            self._shutdown_requested = True
            self._desired_running = False
        self.request_stop(keep_stopped=True)


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
        if parsed.path == "/updates/status":
            self._send_json(
                HTTPStatus.OK,
                read_update_status(self.bridge_server.bridge.root, self.bridge_server.output),
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
        if parsed.path == "/gamerules":
            try:
                self._send_json(
                    HTTPStatus.OK,
                    {
                        "showCoordinates": self.bridge_server.bridge.read_boolean_gamerule("showcoordinates"),
                        "showDaysPlayed": self.bridge_server.bridge.read_boolean_gamerule("showdaysplayed"),
                    },
                )
            except RuntimeError as error:
                self._send_json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": str(error)})
            return
        if parsed.path == "/world/reset/status":
            self._send_json(HTTPStatus.OK, read_world_reset_status())
            return
        if parsed.path == "/structures/materialized":
            query = parse_qs(parsed.query)
            try:
                size = int(query.get("size", [""])[0])
                self._send_json(
                    HTTPStatus.OK,
                    self.bridge_server.bridge.materialized_structure(
                        query.get("structure", [None])[0], size
                    ),
                )
            except (ValueError, RuntimeError) as error:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
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
        if path not in {"/commands", "/properties", "/gamerules", "/world/reset", "/updates", "/structures/export", "/structures/import", "/structures/place"}:
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "No existe esa ruta."})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if path == "/structures/import":
            try:
                self._send_json(
                    HTTPStatus.OK,
                    self.bridge_server.bridge.import_structure(
                        self.headers.get("X-SPB-Structure-Id"), self.rfile, length
                    ),
                )
            except (OSError, ValueError) as error:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            except RuntimeError as error:
                self._send_json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": str(error)})
            return
        if length < 1 or length > MAX_BODY_BYTES:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Cuerpo inválido."})
            return
        try:
            body = json.loads(self.rfile.read(length))
            if path == "/structures/export":
                self._send_json(HTTPStatus.OK, self.bridge_server.bridge.export_structure(body.get("source")))
                return
            if path == "/structures/place":
                self._send_json(HTTPStatus.OK, self.bridge_server.bridge.place_structure(body))
                return
            if path == "/world/reset":
                operation = request_world_reset(self.bridge_server.bridge.root, body)
                self._send_json(HTTPStatus.ACCEPTED, {"ok": True, "environment": "staging", "operation": operation})
                return
            if path == "/updates":
                if body != {"confirmed": True}:
                    raise ValueError("Confirma la actualización antes de continuar.")
                self._send_json(HTTPStatus.ACCEPTED, request_update(self.bridge_server.bridge.root))
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
            if path == "/gamerules":
                updates = {
                    "showCoordinates": ("showcoordinates", body.get("showCoordinates")),
                    "showDaysPlayed": ("showdaysplayed", body.get("showDaysPlayed")),
                }
                requested = {
                    key: (rule, value)
                    for key, (rule, value) in updates.items()
                    if value is not None
                }
                if not requested:
                    raise ValueError("Indica al menos una gamerule para actualizar.")
                if any(not isinstance(value, bool) for _, value in requested.values()):
                    raise ValueError("Las gamerules deben ser verdadero o falso.")
                for rule, value in requested.values():
                    self.bridge_server.bridge.set_boolean_gamerule(rule, value)
                self._send_json(
                    HTTPStatus.ACCEPTED,
                    {"ok": True, **{key: value for key, (_, value) in requested.items()}},
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
    # systemd may start the lifecycle controller immediately after this unit.
    # Block its signals until our handlers exist so an early SIGUSR1/SIGUSR2
    # becomes pending instead of terminating the Python process.
    lifecycle_signals = {signal.SIGUSR1, signal.SIGUSR2}
    signal.pthread_sigmask(signal.SIG_BLOCK, lifecycle_signals)

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("--listen", required=True, type=parse_address)
    parser.add_argument("--state-file", required=True, type=Path)
    arguments = parser.parse_args()

    token = os.environ.get("SPB_BRIDGE_TOKEN", "")
    if len(token) < 32:
        raise RuntimeError("Falta SPB_BRIDGE_TOKEN o no tiene la longitud mínima.")

    output = OutputBuffer()
    bridge = BedrockConsoleBridge(arguments.root, output, arguments.state_file)
    server = BridgeHTTPServer(arguments.listen, bridge, token, output)

    def stop(_signum: int, _frame: object) -> None:
        threading.Thread(target=server.shutdown, name="bridge-shutdown", daemon=True).start()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    signal.signal(
        signal.SIGUSR1,
        lambda _signum, _frame: threading.Thread(
            target=bridge.request_stop,
            kwargs={"keep_stopped": True},
            name="bedrock-maintenance-stop",
            daemon=True,
        ).start(),
    )
    signal.signal(
        signal.SIGUSR2,
        lambda _signum, _frame: threading.Thread(
            target=bridge.start,
            name="bedrock-maintenance-start",
            daemon=True,
        ).start(),
    )
    signal.pthread_sigmask(signal.SIG_UNBLOCK, lifecycle_signals)
    if not arguments.state_file.with_name("desired-stopped").exists():
        bridge.start()
    try:
        server.serve_forever(poll_interval=0.5)
    finally:
        server.server_close()
        bridge.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
