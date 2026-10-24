#!/usr/bin/env python3
"""Promueve el mundo activo de staging hacia producción de forma recuperable."""

from __future__ import annotations

import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = Path("/opt/bedrock")
STAGING_ROOT = Path("/opt/bedrock-staging")
STATE = Path("/var/lib/spb/production-world-promotion")
STATUS = STATE / "status.json"
PRODUCTION_ARCHIVES = ROOT / ".world-promotion-rollback"
TOOLS = Path("/opt/bedrock-deploy")
PRODUCTION_SERVICE = "bedrock.service"
STAGING_SERVICE = "bedrock-staging.service"

sys.path.insert(0, str(TOOLS))
import production_backup  # noqa: E402
import world_backup  # noqa: E402


def write_status(**value: object) -> None:
    STATE.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = STATUS.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, separators=(",", ":")), encoding="utf-8")
    os.chmod(temporary, 0o600)
    os.replace(temporary, STATUS)


def run(*args: str, timeout: int = 180) -> None:
    subprocess.run(args, check=True, timeout=timeout, capture_output=True, text=True)


def read_level_name(root: Path) -> str:
    properties = root / "server.properties"
    if properties.is_symlink() or not properties.is_file():
        raise RuntimeError("Falta server.properties o no es un archivo seguro.")
    for line in properties.read_text(encoding="utf-8").splitlines():
        if line.startswith("level-name="):
            name = line.split("=", 1)[1]
            if name and len(name) <= 64 and "/" not in name and "\\" not in name and name not in {".", ".."}:
                return name
    raise RuntimeError("No se encontró un nombre de mundo válido.")


def world_path(root: Path, name: str) -> Path:
    worlds = root / "worlds"
    path = worlds / name
    if worlds.is_symlink() or not worlds.is_dir() or path.is_symlink() or not path.is_dir():
        raise RuntimeError("El mundo activo no es una carpeta segura.")
    return path


def validate_tree(path: Path) -> None:
    if path.is_symlink() or not path.is_dir():
        raise RuntimeError("La carpeta de mundo no es válida.")
    for child in path.rglob("*"):
        if child.is_symlink() or not (child.is_file() or child.is_dir()):
            raise RuntimeError("El mundo contiene una ruta no autorizada.")


def copy_world(source: Path, destination: Path) -> None:
    validate_tree(source)
    if destination.exists() or destination.is_symlink():
        raise RuntimeError("El destino temporal ya existe.")
    shutil.copytree(source, destination, copy_function=shutil.copy2)
    validate_tree(destination)


def chown_tree(path: Path, uid: int, gid: int) -> None:
    os.chown(path, uid, gid)
    for child in path.rglob("*"):
        os.chown(child, uid, gid)


def service_active(name: str) -> bool:
    return subprocess.run(["systemctl", "is-active", "--quiet", name], check=False).returncode == 0


def start_service(name: str) -> None:
    run("/bin/systemctl", "start", name, timeout=120)


def stop_service(name: str) -> None:
    run("/bin/systemctl", "stop", name, timeout=120)


def rollback_world(target: Path, archived: Path) -> None:
    if not archived.exists():
        return
    if target.exists():
        validate_tree(target)
        shutil.rmtree(target)
    os.replace(archived, target)


def main(operation: str) -> int:
    if not re.fullmatch(r"[0-9a-f]{32}", operation):
        raise RuntimeError("Identificador de operación inválido.")

    started = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    staging_stopped = False
    production_stopped = False
    archived_production: Path | None = None
    target: Path | None = None
    temporary_root: Path | None = None

    try:
        source_name = read_level_name(STAGING_ROOT)
        target_name = read_level_name(ROOT)
        source = world_path(STAGING_ROOT, source_name)
        target = world_path(ROOT, target_name)
        target_parent = target.parent
        target_metadata = target_parent.stat()

        write_status(
            state="copying-staging-world",
            operation=operation,
            sourceWorld=source_name,
            productionWorld=target_name,
            startedAt=started,
        )
        stop_service(STAGING_SERVICE)
        staging_stopped = True
        temporary_root = Path(tempfile.mkdtemp(prefix="promotion-", dir=target_parent))
        candidate = temporary_root / target_name
        copy_world(source, candidate)
        start_service(STAGING_SERVICE)
        staging_stopped = False

        _, source_bytes, environment = production_backup.preflight()
        production_backup.prepare_destination(source_bytes)
        now = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
        archive = production_backup.BACKUP_DIR / f"bedrock-before-world-promotion-{now}-{operation[:8]}.tar.gz"
        write_status(
            state="backing-up-production",
            operation=operation,
            sourceWorld=source_name,
            productionWorld=target_name,
            startedAt=started,
        )
        stop_service(PRODUCTION_SERVICE)
        production_stopped = True
        world_backup.ensure_stopped()
        backup = world_backup.create_backup(ROOT, archive)
        snapshot = production_backup.upload_and_restore(archive, backup["sha256"], environment)

        write_status(
            state="replacing-production-world",
            operation=operation,
            sourceWorld=source_name,
            productionWorld=target_name,
            snapshot=snapshot,
            startedAt=started,
        )
        PRODUCTION_ARCHIVES.mkdir(mode=0o700, exist_ok=True)
        archived_production = PRODUCTION_ARCHIVES / f"{target_name}-{now}-{operation[:8]}"
        if archived_production.exists() or archived_production.is_symlink():
            raise RuntimeError("Ya existe el rollback local de esta promoción.")
        os.replace(target, archived_production)
        os.replace(candidate, target)
        chown_tree(target, target_metadata.st_uid, target_metadata.st_gid)
        target_metadata = target.stat()
        os.chmod(target, target_metadata.st_mode & 0o777)

        write_status(
            state="starting-production",
            operation=operation,
            sourceWorld=source_name,
            productionWorld=target_name,
            snapshot=snapshot,
            startedAt=started,
        )
        start_service(PRODUCTION_SERVICE)
        production_stopped = False
        production_backup.wait_for_running()
        production_backup.apply_retention(environment)
        write_status(
            state="complete",
            operation=operation,
            sourceWorld=source_name,
            productionWorld=target_name,
            snapshot=snapshot,
            backupSha256=backup["sha256"],
            completedAt=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        )
        return 0
    except Exception:
        if archived_production is not None and target is not None:
            try:
                if not production_stopped and service_active(PRODUCTION_SERVICE):
                    stop_service(PRODUCTION_SERVICE)
                    production_stopped = True
                rollback_world(target, archived_production)
            except Exception:
                pass
        write_status(
            state="failed",
            operation=operation,
            error="La promoción no terminó. Se conservó el respaldo y se intentó restaurar el mundo anterior.",
            completedAt=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        )
        raise
    finally:
        if staging_stopped:
            subprocess.run(["/bin/systemctl", "start", STAGING_SERVICE], check=False, timeout=120)
        if production_stopped:
            subprocess.run(["/bin/systemctl", "start", PRODUCTION_SERVICE], check=False, timeout=120)
        if temporary_root is not None and temporary_root.exists():
            shutil.rmtree(temporary_root, ignore_errors=True)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Uso: production_world_promote.py ID")
    raise SystemExit(main(sys.argv[1]))
