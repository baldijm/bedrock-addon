#!/usr/bin/env python3
"""Despliega un commit inmutable del add-on en staging o en producción.

Staging puede reiniciarse. Producción exige --authorized-production-maintenance
y realiza primero un respaldo verificable; no hay modo --apply implícito.
"""

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import time
import uuid

import production_backup
import world_backup


REPOSITORY_URL = "https://github.com/baldijm/bedrock-addon.git"
CACHE = Path("/opt/bedrock-deploy/source")
STATE = Path("/var/lib/bedrock-deploy")
STAGING_ROOT = Path("/opt/bedrock-staging")
PRODUCTION_ROOT = Path("/opt/bedrock")
PACKS = (
    (Path("BP"), Path("behavior_packs/SPB_BP")),
    (Path("RP"), Path("resource_packs/SPB_RP")),
    (Path("experimental/SPB_HTTP_Test"), Path("behavior_packs/SPB_HTTP_Test")),
)
SHA = re.compile(r"^[0-9a-f]{40}$")


def run(*args, timeout=120, cwd=None):
    return subprocess.run(args, check=True, text=True, timeout=timeout, cwd=cwd)


def require_root():
    if not hasattr(os, "geteuid") or os.geteuid() != 0:
        raise RuntimeError("Ejecutar como root")


def require_real_directory(path, name):
    if path.is_symlink() or not path.is_dir():
        raise RuntimeError(f"{name} debe ser una carpeta real: {path}")


def require_commit(value):
    value = value.lower()
    if not SHA.fullmatch(value):
        raise RuntimeError("El commit debe ser un SHA-1 completo de 40 caracteres")
    return value


def checkout_commit(commit):
    """Obtiene exactamente un commit, nunca una rama que pueda cambiar."""
    CACHE.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if CACHE.exists():
        require_real_directory(CACHE, "La caché de código")
        remote = subprocess.run(
            ["git", "remote", "get-url", "origin"], cwd=CACHE, check=True,
            text=True, capture_output=True,
        ).stdout.strip()
        if remote != REPOSITORY_URL:
            raise RuntimeError("La caché apunta a un remoto distinto; se rehúsa usarla")
    else:
        run("git", "clone", "--no-checkout", REPOSITORY_URL, str(CACHE), timeout=180)

    run("git", "fetch", "--depth=1", "origin", commit, cwd=CACHE, timeout=180)
    resolved = subprocess.run(
        ["git", "rev-parse", "FETCH_HEAD^{commit}"], cwd=CACHE, check=True,
        text=True, capture_output=True,
    ).stdout.strip().lower()
    if resolved != commit:
        raise RuntimeError("El remoto no devolvió el commit solicitado")
    run("git", "checkout", "--detach", "--force", commit, cwd=CACHE)
    return CACHE


def validate_source(source):
    for relative, _ in PACKS:
        directory = source / relative
        require_real_directory(directory, f"Paquete fuente {relative}")
        for path in directory.rglob("*"):
            if path.is_symlink():
                raise RuntimeError(f"No se permiten enlaces simbólicos: {path}")
    for manifest in ("BP/manifest.json", "RP/manifest.json", "experimental/SPB_HTTP_Test/manifest.json"):
        if not (source / manifest).is_file():
            raise RuntimeError(f"Falta {manifest}")


def deployment_paths(root):
    require_real_directory(root, "La raíz Bedrock")
    result = []
    for _, relative in PACKS:
        target = root / relative
        if target.is_symlink() or not target.is_dir():
            raise RuntimeError(f"Falta o no es segura la instalación actual: {target}")
        result.append(target)
    return result


def remove_directory(path):
    if path.is_symlink() or not path.is_dir():
        raise RuntimeError(f"Sólo se puede retirar una carpeta real: {path}")
    shutil.rmtree(path)


def copy_packages(source, root, environment):
    """Cambia los paquetes y conserva sus referencias en el mundo activo."""
    targets = deployment_paths(root)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    rollback = STATE / "addon-rollbacks" / environment / f"{stamp}-{uuid.uuid4().hex[:8]}"
    rollback.mkdir(mode=0o700, parents=True)
    moved = []
    try:
        for target in targets:
            saved = rollback / target.name
            shutil.move(str(target), str(saved))
            moved.append((target, saved))
        for relative, destination in PACKS:
            target = root / destination
            shutil.copytree(source / relative, target, copy_function=shutil.copy2)
        ensure_active_world_pack_references(source, root)
    except BaseException:
        for _, destination in PACKS:
            target = root / destination
            if target.exists() and target.is_dir() and not target.is_symlink():
                remove_directory(target)
        for target, saved in moved:
            if saved.exists():
                shutil.move(str(saved), str(target))
        raise
    return rollback


def load_manifest_reference(source, relative):
    manifest = source / relative / "manifest.json"
    try:
        header = json.loads(manifest.read_text(encoding="utf-8"))["header"]
        pack_id = header["uuid"]
        version = header["version"]
    except (OSError, ValueError, KeyError, TypeError) as error:
        raise RuntimeError(f"Manifiesto inválido: {manifest}") from error
    if not isinstance(pack_id, str) or not isinstance(version, list) or len(version) != 3:
        raise RuntimeError(f"Manifiesto inválido: {manifest}")
    if not all(isinstance(part, int) and part >= 0 for part in version):
        raise RuntimeError(f"Manifiesto inválido: {manifest}")
    return {"pack_id": pack_id, "version": version}


def active_world_directory(root):
    properties = root / "server.properties"
    try:
        level_name = next(
            line.split("=", 1)[1]
            for line in properties.read_text(encoding="utf-8").splitlines()
            if line.startswith("level-name=")
        )
    except (OSError, StopIteration) as error:
        raise RuntimeError("No se pudo determinar el mundo activo") from error
    if not level_name or Path(level_name).name != level_name:
        raise RuntimeError("El nombre del mundo activo no es seguro")
    world = root / "worlds" / level_name
    require_real_directory(world, "El mundo activo")
    return world


def replace_pack_reference(world, filename, reference):
    target = world / filename
    existing = []
    if target.exists():
        if target.is_symlink() or not target.is_file():
            raise RuntimeError(f"La referencia de paquetes no es segura: {target}")
        try:
            existing = json.loads(target.read_text(encoding="utf-8"))
        except (OSError, ValueError) as error:
            raise RuntimeError(f"La referencia de paquetes es inválida: {target}") from error
        if not isinstance(existing, list):
            raise RuntimeError(f"La referencia de paquetes es inválida: {target}")
    updated = [entry for entry in existing if not isinstance(entry, dict) or entry.get("pack_id") != reference["pack_id"]]
    updated.append(reference)
    temporary = target.with_suffix(".tmp")
    temporary.write_text(json.dumps(updated, indent=2) + "\n", encoding="utf-8")
    os.chmod(temporary, 0o640)
    temporary.replace(target)


def ensure_active_world_pack_references(source, root):
    """Attach current SPB BP/RP metadata to the configured active world."""
    world = active_world_directory(root)
    replace_pack_reference(world, "world_behavior_packs.json", load_manifest_reference(source, Path("BP")))
    replace_pack_reference(world, "world_resource_packs.json", load_manifest_reference(source, Path("RP")))


def write_receipt(environment, commit, rollback):
    receipts = STATE / "receipts"
    receipts.mkdir(mode=0o700, parents=True, exist_ok=True)
    receipt = receipts / f"{environment}.json"
    temporary = receipt.with_suffix(".tmp")
    payload = {
        "environment": environment,
        "commit": commit,
        "deployed_utc": datetime.now(timezone.utc).isoformat(),
        "rollback": str(rollback),
    }
    temporary.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    os.chmod(temporary, 0o600)
    temporary.replace(receipt)


def staging_running():
    return subprocess.run(
        ["systemctl", "is-active", "--quiet", "bedrock-staging.service"], check=False
    ).returncode == 0


def restart_staging():
    run("systemctl", "restart", "bedrock-staging.service", timeout=120)
    if not staging_running():
        raise RuntimeError("Staging no quedó activo tras desplegar")


def production_receipt_matches(commit):
    receipt = STATE / "receipts/staging.json"
    if receipt.is_symlink() or not receipt.is_file():
        raise RuntimeError("No hay recibo de staging para este commit")
    recorded = json.loads(receipt.read_text(encoding="utf-8"))
    if recorded.get("commit") != commit:
        raise RuntimeError("El commit no es el último desplegado en staging")


def deploy_staging(source, commit):
    rollback = copy_packages(source, STAGING_ROOT, "staging")
    restart_staging()
    write_receipt("staging", commit, rollback)
    print(f"OK: staging actualizado a {commit}; rollback: {rollback}")


def deploy_production(source, commit):
    """Ventana única: respaldo local, cambio de paquetes y retorno del servicio."""
    production_receipt_matches(commit)
    _, source_bytes, environment = production_backup.preflight()
    now = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    archive = production_backup.BACKUP_DIR / f"bedrock-before-addon-{now}-{uuid.uuid4().hex[:8]}.tar.gz"
    stopped = False
    backup_result = None
    rollback = None
    deployment_error = None
    try:
        stopped = True
        production_backup.run_service("stop", 120)
        world_backup.ensure_stopped()
        backup_result = world_backup.create_backup(PRODUCTION_ROOT, archive)
        rollback = copy_packages(source, PRODUCTION_ROOT, "production")
    except BaseException as error:
        deployment_error = error
    finally:
        if stopped:
            production_backup.run_service("start", 120)
            production_backup.wait_for_running()
    if deployment_error:
        raise deployment_error
    print(f"Producción volvió activa; archivo local verificado ({source_bytes} bytes de origen).", flush=True)
    snapshot = production_backup.upload_and_restore(archive, backup_result["sha256"], environment)
    production_backup.apply_retention(environment)
    write_receipt("production", commit, rollback)
    print(f"OK: producción actualizada a {commit}; R2 verificado: {snapshot}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("environment", choices=("staging", "production"))
    parser.add_argument("--commit", required=True, help="SHA-1 completo de GitHub")
    parser.add_argument("--authorized-production-maintenance", action="store_true")
    args = parser.parse_args()
    require_root()
    commit = require_commit(args.commit)
    if args.environment == "production" and not args.authorized_production_maintenance:
        parser.error("producción requiere autorización expresa de mantenimiento")
    source = checkout_commit(commit)
    validate_source(source)
    if args.environment == "staging":
        deploy_staging(source, commit)
    else:
        deploy_production(source, commit)


if __name__ == "__main__":
    try:
        main()
    except BaseException as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
