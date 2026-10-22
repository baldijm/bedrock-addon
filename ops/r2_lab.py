#!/usr/bin/env python3
"""Prueba R2/restic con datos ficticios; no lee ni modifica Minecraft."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import uuid


CONFIG_PATH = Path("/etc/bedrock-backup/r2.json")
EXPECTED_ACCOUNT = "6cd576a97c96530c111a660c11d9e663"
EXPECTED_BUCKET = "spb-bedrock-world-backups"


def restic_environment(config):
    required = ("account_id", "bucket", "access_key_id", "secret_access_key", "restic_password")
    if any(not isinstance(config.get(key), str) or not config[key] for key in required):
        raise RuntimeError("Falta un campo de la configuración privada")
    if config["account_id"] != EXPECTED_ACCOUNT or config["bucket"] != EXPECTED_BUCKET:
        raise RuntimeError("La configuración no apunta al bucket de laboratorio previsto")
    environment = os.environ.copy()
    environment.pop("RESTIC_PASSWORD_FILE", None)
    environment.pop("AWS_SESSION_TOKEN", None)
    environment.update(
        AWS_ACCESS_KEY_ID=config["access_key_id"],
        AWS_SECRET_ACCESS_KEY=config["secret_access_key"],
        AWS_DEFAULT_REGION="auto",
        RESTIC_PASSWORD=config["restic_password"],
        RESTIC_REPOSITORY=(
            f"s3:https://{config['account_id']}.r2.cloudflarestorage.com/{config['bucket']}"
        ),
    )
    return environment


def load_environment():
    if not hasattr(os, "geteuid") or os.geteuid() != 0:
        raise RuntimeError("Ejecutar como root para leer la configuración privada")
    if CONFIG_PATH.is_symlink():
        raise RuntimeError("La configuración no puede ser un enlace simbólico")
    metadata = CONFIG_PATH.stat(follow_symlinks=False)
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != 0:
        raise RuntimeError("La configuración debe ser un archivo de root")
    if stat.S_IMODE(metadata.st_mode) != 0o600:
        raise RuntimeError("La configuración debe tener permisos 0600")
    return restic_environment(json.loads(CONFIG_PATH.read_text(encoding="utf-8")))


def run_restic(environment, *arguments):
    result = subprocess.run(
        ["restic", *arguments], env=environment, text=True, capture_output=True, check=False
    )
    if result.returncode:
        # La salida de restic puede contener datos del destino; no se reproduce aquí.
        raise RuntimeError(f"restic {arguments[0]} falló (código {result.returncode})")
    return result.stdout


def probe(environment):
    with tempfile.TemporaryDirectory(prefix="bedrock-r2-lab-") as temporary:
        base = Path(temporary)
        source = base / "source"
        source.mkdir(mode=0o700)
        marker = source / f"fixture-{uuid.uuid4().hex}.bin"
        content = os.urandom(256)
        marker.write_bytes(content)
        tag = f"spb-lab-{uuid.uuid4().hex}"

        run_restic(environment, "backup", "--tag", tag, "--host", "spb-lab", str(marker))
        snapshots = json.loads(run_restic(environment, "snapshots", "--json", "--tag", tag))
        if len(snapshots) != 1:
            raise RuntimeError("No se encontró exactamente un snapshot de laboratorio")
        snapshot_id = snapshots[0]["id"]
        run_restic(environment, "check")
        destination = base / "restored"
        destination.mkdir(mode=0o700)
        run_restic(environment, "restore", snapshot_id, "--target", str(destination))
        restored = list(destination.rglob(marker.name))
        if len(restored) != 1 or hashlib.sha256(restored[0].read_bytes()).digest() != hashlib.sha256(content).digest():
            raise RuntimeError("El archivo ficticio restaurado no coincide")
    print("OK: archivo ficticio cifrado, subido y restaurado desde R2; Minecraft no se tocó.")
    print("El snapshot de prueba permanece en R2; no se aplicó retención ni borrado.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("init", "probe", "init-and-probe"))
    arguments = parser.parse_args()
    environment = load_environment()
    if arguments.action in ("init", "init-and-probe"):
        run_restic(environment, "init")
        print("OK: repositorio cifrado inicializado en R2; todavía no hay respaldo de Minecraft.")
    if arguments.action in ("probe", "init-and-probe"):
        probe(environment)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, RuntimeError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
