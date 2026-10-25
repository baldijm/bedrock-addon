#!/usr/bin/env python3
"""Copia autorizada: detiene Bedrock solo durante el archivo y lo reinicia siempre."""

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time
import uuid

import r2_lab
import world_backup


ROOT = Path("/opt/bedrock")
BACKUP_DIR = Path("/var/backups/bedrock")
MAX_SOURCE_BYTES = 1024 * 1024 * 1024
PRODUCTION_BRIDGE_STATE = Path("/run/spb-production-bridge/bedrock.pid")


def service_running():
    active = subprocess.run(
        ["systemctl", "is-active", "--quiet", "bedrock.service"], check=False
    ).returncode == 0
    if not active:
        return False

    # Staging usa el mismo ejecutable. Consultar todos los procesos por nombre
    # permitiría que staging hiciera pasar a producción por sana.
    result = subprocess.run(
        ["systemctl", "show", "bedrock.service", "--property=MainPID", "--value"],
        check=False,
        text=True,
        capture_output=True,
    )
    try:
        pid = int(result.stdout.strip())
    except ValueError:
        pid = 0
    if result.returncode == 0 and pid > 0:
        try:
            if Path(f"/proc/{pid}/comm").read_text().strip() == "bedrock_server":
                return True
        except OSError:
            pass

    # Production may run through the persistent console bridge. Its parent is
    # Python, so read the bridge's explicit child PID instead of treating the
    # control unit's MainPID as Bedrock itself.
    try:
        child_pid = int(PRODUCTION_BRIDGE_STATE.read_text(encoding="ascii").strip())
        return Path(f"/proc/{child_pid}/comm").read_text().strip() == "bedrock_server"
    except (FileNotFoundError, OSError, ValueError):
        return False


def run_service(action, timeout):
    subprocess.run(["systemctl", action, "bedrock.service"], check=True, timeout=timeout)


def wait_for_running(seconds=60):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if service_running():
            return
        time.sleep(1)
    raise RuntimeError("Bedrock no volvió a estado activo con proceso visible")


def prepare_destination(source_bytes):
    parent = BACKUP_DIR.parent
    if parent.is_symlink() or not parent.is_dir():
        raise RuntimeError("La carpeta padre del respaldo no es válida")
    free = shutil.disk_usage(parent).free
    if free < source_bytes * 4 + 200 * 1024 * 1024:
        raise RuntimeError("Espacio insuficiente para archivo y restauración de prueba")
    if BACKUP_DIR.is_symlink():
        raise RuntimeError("La carpeta de respaldos no puede ser un enlace simbólico")
    BACKUP_DIR.mkdir(mode=0o700, exist_ok=True)
    metadata = BACKUP_DIR.stat(follow_symlinks=False)
    if (
        not stat.S_ISDIR(metadata.st_mode)
        or metadata.st_uid != 0
        or stat.S_IMODE(metadata.st_mode) != 0o700
    ):
        raise RuntimeError("La carpeta de respaldos debe ser de root con permisos 0700")


def preflight():
    if not hasattr(os, "geteuid") or os.geteuid() != 0:
        raise RuntimeError("Ejecutar como root")
    if not service_running():
        raise RuntimeError("Bedrock no está activo antes de la ventana; no se detendrá")
    if ROOT.is_symlink() or not ROOT.is_dir():
        raise RuntimeError("La raíz de Bedrock no es una carpeta real")
    files = world_backup.source_files(ROOT)
    source_bytes = sum(path.stat().st_size for path in files)
    if source_bytes > MAX_SOURCE_BYTES:
        raise RuntimeError(
            f"Datos de mundos/configuración ({source_bytes} bytes) exceden el límite conservador de 1 GiB; no se detendrá Bedrock"
        )
    prepare_destination(source_bytes)
    if not shutil.which("restic"):
        raise RuntimeError("restic no está instalado; no se detendrá Bedrock")
    environment = r2_lab.load_environment()
    # Lectura de R2 antes de detener producción: fallo de red o claves no causa downtime.
    json.loads(r2_lab.run_restic(environment, "snapshots", "--json"))
    return files, source_bytes, environment


def create_during_maintenance(path):
    stopped = False
    backup_error = None
    result = None
    try:
        # La restauración del servicio en finally se intenta incluso si stop falla a medias.
        stopped = True
        run_service("stop", 120)
        world_backup.ensure_stopped()
        result = world_backup.create_backup(ROOT, path)
    except BaseException as error:
        backup_error = error
    finally:
        if stopped:
            try:
                run_service("start", 120)
                wait_for_running()
            except BaseException as restart_error:
                raise RuntimeError(
                    "URGENTE: no se confirmó el arranque de Bedrock tras el respaldo"
                ) from restart_error
    if backup_error is not None:
        raise backup_error
    return result


def upload_and_restore(path, expected_sha256, environment):
    tag = f"spb-world-{uuid.uuid4().hex}"
    r2_lab.run_restic(
        environment,
        "backup",
        "--tag", "spb-world",
        "--tag", tag,
        "--host", "bedrock-01", str(path),
    )
    snapshots = json.loads(r2_lab.run_restic(environment, "snapshots", "--json", "--tag", tag))
    if len(snapshots) != 1:
        raise RuntimeError("No se encontró exactamente un snapshot del archivo de mundo")
    snapshot_id = snapshots[0]["id"]
    r2_lab.run_restic(environment, "check", "--read-data")
    with tempfile.TemporaryDirectory(prefix="restore-check-", dir=BACKUP_DIR) as temporary:
        destination = Path(temporary)
        r2_lab.run_restic(environment, "restore", snapshot_id, "--target", str(destination))
        restored = list(destination.rglob(path.name))
        if len(restored) != 1:
            raise RuntimeError("No se encontró el archivo restaurado desde R2")
        if world_backup.sha256_file(restored[0]) != expected_sha256:
            raise RuntimeError("El SHA-256 del archivo restaurado no coincide")
        world_backup.verify_backup(restored[0])
        lab_destination = destination / "world-lab"
        world_backup.restore_lab(restored[0], lab_destination)
    return snapshot_id


def apply_retention(environment):
    """Conserva ocho copias reales; nunca afecta las pruebas de laboratorio."""
    r2_lab.run_restic(
        environment, "forget", "--tag", "spb-world", "--keep-last", "8", "--prune"
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--authorized-maintenance", action="store_true")
    arguments = parser.parse_args()
    if not arguments.authorized_maintenance:
        parser.error("se requiere autorización expresa para detener y reiniciar Bedrock")
    _, source_bytes, environment = preflight()
    now = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = BACKUP_DIR / f"bedrock-{now}-{uuid.uuid4().hex[:8]}.tar.gz"
    print(f"Preflight OK: {source_bytes} bytes de datos; comienza la ventana de mantenimiento.", flush=True)
    def interrupted(_signal, _frame):
        raise RuntimeError("Conexión interrumpida durante la ventana de mantenimiento")

    signal.signal(signal.SIGHUP, interrupted)
    signal.signal(signal.SIGTERM, interrupted)
    result = create_during_maintenance(path)
    print("Bedrock volvió a estado activo con proceso visible; archivo local verificado.", flush=True)
    print(f"Archivo local privado: {path}", flush=True)
    print(f"SHA-256: {result['sha256']}; archivos: {result['files']}", flush=True)
    snapshot_id = upload_and_restore(path, result["sha256"], environment)
    apply_retention(environment)
    if not service_running():
        raise RuntimeError("Bedrock dejó de estar activo durante la verificación remota")
    print(f"R2 verificado: snapshot {snapshot_id}; archivo restaurado y hashes correctos.")
    print("Retención aplicada: se conservan hasta ocho snapshots con etiqueta spb-world.")
    print("No se probó el arranque del mundo en un Minecraft aislado ni el acceso de jugadores.")


if __name__ == "__main__":
    try:
        main()
    except BaseException as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
