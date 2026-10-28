#!/usr/bin/env python3
"""Finish the remote-verification phase of an already completed pack deploy.

This utility intentionally never stops Bedrock or copies packs.  It only
verifies an existing local archive, uploads and restores that archive through
the configured R2/restic repository, then writes the deployment receipt once
Bedrock is still active. It does not delete old snapshots.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import addon_deploy
import production_backup
import world_backup


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", required=True, type=Path)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--rollback", required=True, type=Path)
    arguments = parser.parse_args()

    commit = addon_deploy.require_commit(arguments.commit)
    archive = arguments.archive.resolve()
    rollback = arguments.rollback.resolve()
    if not archive.is_file() or archive.is_symlink():
        raise RuntimeError("El archivo de respaldo no es seguro")
    if not rollback.is_dir() or rollback.is_symlink():
        raise RuntimeError("El directorio de rollback no es seguro")
    if not production_backup.service_running():
        raise RuntimeError("Bedrock no está activo; no se finaliza el recibo")

    world_backup.verify_backup(archive)
    checksum = world_backup.sha256_file(archive)
    environment = production_backup.r2_lab.load_environment()
    snapshot = production_backup.upload_and_restore(archive, checksum, environment)
    if not production_backup.service_running():
        raise RuntimeError("Bedrock dejó de estar activo durante la verificación remota")
    addon_deploy.write_receipt("production", commit, rollback)
    print(f"OK: R2 verificado: {snapshot}; recibo de producción actualizado a {commit}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
