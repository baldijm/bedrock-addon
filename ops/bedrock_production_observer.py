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
from pathlib import Path
import re
import subprocess
from urllib.parse import urlparse
import uuid


SERVICE = "bedrock.service"
MAX_LOG_LINES = 300
ROOT = Path("/opt/bedrock")
WORLDS_ROOT = ROOT / "worlds"
PROMOTION_STATUS = Path("/var/lib/spb/production-world-promotion/status.json")
PROMOTION_UNIT = "spb-production-world-promote@{}.service"
SAFE_PROPERTIES = {
    "server-name", "level-name", "gamemode", "difficulty", "max-players",
    "view-distance", "tick-distance", "allow-cheats", "allow-list",
    "default-player-permission-level", "player-idle-timeout", "showcoordinates",
    "online-mode", "transport", "server-port", "texturepack-required",
}
WORLD_GAMERULES = {
    "showCoordinates": "showcoordinates",
    "showDaysPlayed": "showdaysplayed",
}


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


def production_properties() -> dict[str, str]:
    path = ROOT / "server.properties"
    if path.is_symlink() or not path.is_file():
        raise RuntimeError("No se pudo leer server.properties de producción.")
    properties: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if "=" not in line or line.startswith("#"):
            continue
        key, value = line.split("=", 1)
        if key in SAFE_PROPERTIES:
            properties[key] = value
    return properties


def production_gamerules() -> dict[str, bool]:
    """Read selected boolean gamerules directly from the active world's level.dat.

    Bedrock stores these rules in the world's little-endian NBT data, not in
    server.properties.  This observer only examines the byte-tag values and
    never opens a console connection or modifies the world.
    """
    world = production_properties().get("level-name", "")
    if not world or world in {".", ".."} or "/" in world or "\\" in world:
        raise RuntimeError("El nombre del mundo activo de producción no es válido.")
    level_dat = WORLDS_ROOT / world / "level.dat"
    if level_dat.is_symlink() or not level_dat.is_file():
        raise RuntimeError("No se pudo leer level.dat del mundo activo de producción.")
    try:
        data = level_dat.read_bytes()
    except OSError as error:
        raise RuntimeError("No se pudo leer level.dat del mundo activo de producción.") from error

    values: dict[str, bool] = {}
    for response_key, rule_name in WORLD_GAMERULES.items():
        encoded_name = rule_name.encode("ascii")
        # NBT TAG_Byte (1), name length as little-endian uint16, field name,
        # then the boolean byte (0 or 1).
        marker = b"\x01" + len(encoded_name).to_bytes(2, "little") + encoded_name
        index = data.find(marker)
        value_index = index + len(marker)
        if index < 0 or value_index >= len(data) or data[value_index] not in {0, 1}:
            raise RuntimeError(f"No se pudo leer la gamerule {rule_name} del mundo activo.")
        values[response_key] = data[value_index] == 1
    return values


def promotion_status() -> dict[str, object]:
    if not PROMOTION_STATUS.exists():
        return {"state": "idle"}
    if PROMOTION_STATUS.is_symlink() or not PROMOTION_STATUS.is_file():
        raise RuntimeError("El estado de promoción no es válido.")
    parsed = json.loads(PROMOTION_STATUS.read_text(encoding="utf-8"))
    if not isinstance(parsed, dict):
        raise RuntimeError("El estado de promoción no es válido.")
    return parsed


def request_promotion(confirmation: object) -> dict[str, object]:
    properties = production_properties()
    world = properties.get("level-name", "")
    if not world or confirmation != world:
        raise ValueError("Escribe exactamente el nombre del mundo de producción para confirmar.")
    status = promotion_status()
    if status.get("state") in {"copying-staging-world", "backing-up-production", "replacing-production-world", "starting-production"}:
        raise RuntimeError("Ya hay una promoción de mundo en curso.")
    operation = uuid.uuid4().hex
    unit = PROMOTION_UNIT.format(operation)
    subprocess.run(["systemctl", "start", "--no-block", unit], check=True, timeout=15, capture_output=True, text=True)
    return {"ok": True, "operation": operation, "productionWorld": world, "state": "queued"}


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
        if path == "/properties":
            try:
                self.send_json(HTTPStatus.OK, {"environment": "production", "readOnly": True, "properties": production_properties()})
            except RuntimeError as error:
                self.send_json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": str(error)})
            return
        if path == "/gamerules":
            try:
                self.send_json(
                    HTTPStatus.OK,
                    {"environment": "production", "readOnly": True, **production_gamerules()},
                )
            except RuntimeError as error:
                self.send_json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": str(error)})
            return
        if path == "/world/promotion":
            try:
                self.send_json(HTTPStatus.OK, promotion_status())
            except RuntimeError as error:
                self.send_json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": str(error)})
            return
        self.send_json(HTTPStatus.NOT_FOUND, {"error": "No existe esa ruta."})

    def do_POST(self) -> None:  # noqa: N802
        if not self.authorized():
            self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "No autorizado."})
            return
        if urlparse(self.path).path != "/world/promotion":
            self.send_json(HTTPStatus.METHOD_NOT_ALLOWED, {"error": "Producción está disponible sólo en lectura."})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 1024:
                raise ValueError("Solicitud de promoción inválida.")
            body = json.loads(self.rfile.read(length))
            if not isinstance(body, dict):
                raise ValueError("Solicitud de promoción inválida.")
            self.send_json(HTTPStatus.ACCEPTED, request_promotion(body.get("confirmation")))
        except ValueError as error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
        except subprocess.SubprocessError:
            self.send_json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "No se pudo iniciar la promoción."})
        except RuntimeError as error:
            self.send_json(HTTPStatus.CONFLICT, {"error": str(error)})


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
