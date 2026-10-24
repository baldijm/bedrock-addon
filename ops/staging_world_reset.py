#!/usr/bin/env python3
"""Safely archive and replace the active staging Bedrock world.

Only launched by the templated systemd unit. It never targets production.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path("/opt/bedrock-staging")
STATE = Path("/var/lib/spb/staging-world-reset")
REQUESTS = STATE / "requests"
STATUS = STATE / "status.json"
BACKUPS = Path("/var/backups/bedrock-staging")
SERVICE = "bedrock-staging.service"
TOOLS = Path("/opt/bedrock-deploy")
sys.path.insert(0, str(TOOLS))
import r2_lab  # noqa: E402
import world_backup  # noqa: E402


def write_status(**value: object) -> None:
    STATE.mkdir(parents=True, exist_ok=True)
    temporary = STATUS.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, separators=(",", ":")), encoding="utf-8")
    os.replace(temporary, STATUS)


def run(*args: str, timeout: int = 180) -> None:
    subprocess.run(args, check=True, timeout=timeout, capture_output=True, text=True)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def set_seed(seed: str) -> None:
    path = ROOT / "server.properties"
    lines = path.read_text(encoding="utf-8").splitlines()
    replaced = False
    output: list[str] = []
    for line in lines:
        if line.startswith("level-seed="):
            output.append(f"level-seed={seed}")
            replaced = True
        else:
            output.append(line)
    if not replaced:
        output.append(f"level-seed={seed}")
    temporary = path.with_suffix(".reset.tmp")
    temporary.write_text("\n".join(output) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def verified_r2_backup(archive: Path) -> str:
    environment = r2_lab.load_environment()
    r2_lab.run_restic(environment, "snapshots", "--json")
    r2_lab.run_restic(environment, "backup", "--tag", "spb-staging-world-reset", str(archive))
    snapshots = json.loads(r2_lab.run_restic(environment, "snapshots", "--json", "--tag", "spb-staging-world-reset"))
    if not snapshots:
        raise RuntimeError("R2 no confirmó el snapshot de staging.")
    snapshot = snapshots[-1].get("short_id")
    if not isinstance(snapshot, str):
        raise RuntimeError("Snapshot de R2 inválido.")
    r2_lab.run_restic(environment, "check")
    with tempfile.TemporaryDirectory(prefix="staging-reset-restore-", dir=BACKUPS) as temporary:
        target = Path(temporary)
        r2_lab.run_restic(environment, "restore", snapshot, "--target", str(target))
        restored = list(target.rglob(archive.name))
        if len(restored) != 1 or sha256(restored[0]) != sha256(archive):
            raise RuntimeError("No se verificó la restauración del respaldo de staging.")
        world_backup.verify_backup(restored[0])
    return snapshot


def main(operation: str) -> int:
    if not re.fullmatch(r"[0-9a-f]{32}", operation):
        raise RuntimeError("Identificador de operación inválido.")
    request_path = REQUESTS / f"{operation}.json"
    request = json.loads(request_path.read_text(encoding="utf-8"))
    world = request.get("world")
    seed = request.get("seed")
    if not isinstance(world, str) or not world or "/" in world or "\\" in world or not isinstance(seed, str):
        raise RuntimeError("Solicitud de mundo inválida.")
    properties = ROOT / "server.properties"
    active_name = next((line.split("=", 1)[1] for line in properties.read_text(encoding="utf-8").splitlines() if line.startswith("level-name=")), "")
    if active_name != world:
        raise RuntimeError("El mundo activo cambió desde la confirmación.")
    source = ROOT / "worlds" / world
    if not source.is_dir() or source.is_symlink():
        raise RuntimeError("No existe el mundo de staging que se confirmó.")
    BACKUPS.mkdir(parents=True, exist_ok=True)
    now = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    archive = BACKUPS / f"staging-before-world-reset-{now}-{operation[:8]}.tar.gz"
    was_stopped = False
    try:
        write_status(state="backing-up", operation=operation, world=world, startedAt=now)
        run("/bin/systemctl", "stop", SERVICE, timeout=90)
        was_stopped = True
        result = world_backup.create_backup(ROOT, archive, check_stopped=lambda: None)
        snapshot = verified_r2_backup(archive)
        write_status(state="replacing-world", operation=operation, world=world, snapshot=snapshot)
        archived_worlds = ROOT / ".world-archive"
        archived_worlds.mkdir(mode=0o700, exist_ok=True)
        os.replace(source, archived_worlds / f"{world}-{now}-{operation[:8]}")
        set_seed(seed)
        run("/bin/systemctl", "start", SERVICE, timeout=90)
        was_stopped = False
        write_status(state="complete", operation=operation, world=world, snapshot=snapshot, backupSha256=result["sha256"], completedAt=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
        return 0
    except Exception as error:
        write_status(state="failed", operation=operation, world=world, error="El reinicio del mundo no terminó. El respaldo y el archivo local se conservan.")
        raise error
    finally:
        request_path.unlink(missing_ok=True)
        if was_stopped:
            subprocess.run(["/bin/systemctl", "start", SERVICE], check=False, timeout=90)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Uso: staging_world_reset.py ID")
    raise SystemExit(main(sys.argv[1]))
