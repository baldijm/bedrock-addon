#!/usr/bin/env python3
"""Safely update one SPB Bedrock server from Mojang's official Linux feed.

This program is deliberately invoked by an instance systemd unit.  A request
file is written first, so an HTTP request can return before Bedrock is stopped.
It never accepts a user supplied download URL.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
import urllib.parse
import uuid
import zipfile
from pathlib import Path


FEED_URL = "https://net-secondary.web.minecraft-services.net/api/v1.0/download/links"
REQUESTS = Path("/var/lib/spb/bedrock-update/requests")
STATUS = Path("/var/lib/spb/bedrock-update/status")
WORK = Path("/var/lib/spb/bedrock-update/work")
VERSION_PATTERN = re.compile(r"/bedrock-server-([0-9]+(?:\.[0-9]+){2,3})\.zip$")
ROOTS = {"staging": Path("/opt/bedrock-staging"), "production": Path("/opt/bedrock")}
SERVICES = {"staging": "bedrock-staging.service", "production": "bedrock.service"}
PRESERVED = {"worlds", "server.properties", "allowlist.json", "permissions.json", "whitelist.json", ".api-token", "logs"}


def write_status(environment: str, state: str, **values: object) -> None:
    STATUS.mkdir(mode=0o750, parents=True, exist_ok=True)
    target = STATUS / f"{environment}.json"
    payload = {"environment": environment, "state": state, "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), **values}
    temporary = target.with_name(f".{target.name}.{uuid.uuid4().hex}.tmp")
    temporary.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    os.chmod(temporary, 0o644)
    os.replace(temporary, target)


def official_release() -> tuple[str, str]:
    request = urllib.request.Request(FEED_URL, headers={"User-Agent": "SPB-Bedrock-Updater/1"})
    with urllib.request.urlopen(request, timeout=30) as response:
        body = json.load(response)
    links = body.get("result", {}).get("links", [])
    item = next((link for link in links if link.get("downloadType") == "serverBedrockLinux"), None)
    if not isinstance(item, dict) or not isinstance(item.get("downloadUrl"), str):
        raise RuntimeError("La fuente oficial no entregó el paquete Linux estable.")
    url = item["downloadUrl"]
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or parsed.netloc not in {"www.minecraft.net", "minecraft.azureedge.net"}:
        raise RuntimeError("La fuente oficial entregó un host de descarga inesperado.")
    match = VERSION_PATTERN.search(parsed.path)
    if not match:
        raise RuntimeError("No se pudo identificar la versión del paquete oficial.")
    return match.group(1), url


def download(url: str, destination: Path) -> None:
    request = urllib.request.Request(url, headers={"User-Agent": "SPB-Bedrock-Updater/1", "Referer": "https://www.minecraft.net/en-us/download/server/bedrock"})
    with urllib.request.urlopen(request, timeout=60) as response, destination.open("wb") as output:
        while chunk := response.read(1024 * 1024):
            output.write(chunk)


def validate_archive(path: Path, destination: Path) -> None:
    with zipfile.ZipFile(path) as archive:
        invalid = archive.testzip()
        if invalid:
            raise RuntimeError(f"El ZIP oficial no pasó la verificación: {invalid}")
        names = archive.namelist()
        if "bedrock_server" not in names:
            raise RuntimeError("El ZIP oficial no contiene bedrock_server.")
        for name in names:
            parts = Path(name).parts
            if Path(name).is_absolute() or ".." in parts:
                raise RuntimeError("El ZIP oficial contiene una ruta no válida.")
        archive.extractall(destination)


def service(action: str, name: str, timeout: int = 150) -> None:
    subprocess.run(["/bin/systemctl", action, name], check=True, timeout=timeout)


def active(name: str) -> bool:
    return subprocess.run(["/bin/systemctl", "is-active", "--quiet", name], check=False).returncode == 0


def preserve_custom_packs(root: Path, hold: Path) -> None:
    for pack in (("behavior_packs", "SPB_BP"), ("resource_packs", "SPB_RP")):
        source = root.joinpath(*pack)
        if source.exists() and not source.is_symlink():
            destination = hold.joinpath(*pack)
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(source, destination, symlinks=True)


def restore_custom_packs(root: Path, hold: Path) -> None:
    for top in ("behavior_packs", "resource_packs"):
        source = hold / top
        if not source.exists():
            continue
        for pack in source.iterdir():
            destination = root / top / pack.name
            if destination.exists():
                shutil.rmtree(destination)
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(pack, destination, symlinks=True)


def copy_release(source: Path, root: Path, hold: Path) -> None:
    # Worlds, configuration and SPB packs are application data, not BDS files.
    preserve_custom_packs(root, hold)
    for item in source.iterdir():
        if item.name in PRESERVED or item.name in {"behavior_packs", "resource_packs"}:
            continue
        target = root / item.name
        if item.is_dir():
            shutil.copytree(item, target, dirs_exist_ok=True, symlinks=True)
        else:
            shutil.copy2(item, target, follow_symlinks=False)
    for top in ("behavior_packs", "resource_packs"):
        source_top = source / top
        if source_top.exists():
            shutil.copytree(source_top, root / top, dirs_exist_ok=True, symlinks=True)
    restore_custom_packs(root, hold)
    binary = root / "bedrock_server"
    binary.chmod(binary.stat().st_mode | 0o111)
    subprocess.run(["/bin/chown", "-R", "bedrock:bedrock", str(root)], check=True, timeout=120)


def update(environment: str, operation: str) -> None:
    if os.geteuid() != 0:
        raise RuntimeError("El actualizador debe ejecutarse como root.")
    if environment not in ROOTS:
        raise RuntimeError("Entorno de actualización inválido.")
    root, unit = ROOTS[environment], SERVICES[environment]
    if root.is_symlink() or not root.is_dir():
        raise RuntimeError("La raíz de Bedrock no es una carpeta válida.")
    version, url = official_release()
    write_status(environment, "preparing", operation=operation, availableVersion=version)
    WORK.mkdir(mode=0o700, parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=f"{environment}-{operation[:8]}-", dir=WORK) as temporary:
        temporary_path = Path(temporary)
        archive = temporary_path / "bedrock-server.zip"
        extracted = temporary_path / "release"
        extracted.mkdir()
        write_status(environment, "downloading", operation=operation, availableVersion=version)
        download(url, archive)
        write_status(environment, "validating", operation=operation, availableVersion=version)
        validate_archive(archive, extracted)
        was_active = active(unit)
        if environment == "production":
            # This provides a full, encrypted, restored-and-verified world backup
            # before the release files are ever changed.
            write_status(environment, "backing-up", operation=operation, availableVersion=version)
            subprocess.run(["/usr/bin/python3", "/opt/bedrock-deploy/production_backup.py", "--authorized-maintenance"], check=True, timeout=1500)
        if was_active:
            write_status(environment, "stopping", operation=operation, availableVersion=version)
            service("stop", unit)
        hold = temporary_path / "preserved-packs"
        write_status(environment, "installing", operation=operation, availableVersion=version)
        try:
            copy_release(extracted, root, hold)
            (root / ".spb-bedrock-version.json").write_text(json.dumps({"version": version, "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}), encoding="utf-8")
            shutil.chown(root / ".spb-bedrock-version.json", user="bedrock", group="bedrock")
            if was_active:
                write_status(environment, "starting", operation=operation, availableVersion=version)
                service("start", unit)
                if not active(unit):
                    raise RuntimeError("Bedrock no quedó activo después de actualizar.")
        except BaseException:
            if was_active and not active(unit):
                subprocess.run(["/bin/systemctl", "start", unit], check=False, timeout=150)
            raise
    write_status(environment, "complete", operation=operation, installedVersion=version, availableVersion=version)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--request", required=True, help="identificador de solicitud")
    parser.add_argument("--environment", choices=sorted(ROOTS), required=True)
    args = parser.parse_args()
    if not re.fullmatch(r"[0-9a-f]{32}", args.request):
        raise RuntimeError("Identificador de actualización inválido.")
    request = REQUESTS / f"{args.request}.json"
    data = json.loads(request.read_text(encoding="utf-8"))
    environment = data.get("environment") if isinstance(data, dict) else None
    if environment != args.environment:
        raise RuntimeError("Solicitud de actualización inválida.")
    try:
        update(environment, args.request)
    except BaseException as error:
        write_status(environment, "failed", operation=args.request, error=str(error))
        raise
    finally:
        request.unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    try:
        exit_code = main()
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
    raise SystemExit(exit_code)
