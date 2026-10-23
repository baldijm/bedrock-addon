#!/usr/bin/env python3
"""Archivo verificable de datos Bedrock; solo crea copias con el servidor detenido."""

import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import tarfile
import tempfile
from datetime import datetime, timezone


CONFIG_FILES = ("server.properties", "allowlist.json", "permissions.json")
MANIFEST = "backup-manifest.json"


def ensure_stopped():
    """Comprueba exclusivamente el servicio de producción.

    Staging puede ejecutar otro proceso ``bedrock_server`` en la misma VM, por
    lo que nunca se debe usar un ``pgrep`` global como señal de que producción
    sigue activa.
    """
    if shutil.which("systemctl"):
        active = subprocess.run(
            ["systemctl", "is-active", "--quiet", "bedrock.service"],
            check=False,
        )
        if active.returncode == 0:
            raise RuntimeError("bedrock.service sigue activo")


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def source_files(root):
    worlds = root / "worlds"
    if not worlds.is_dir() or worlds.is_symlink():
        raise RuntimeError("Falta worlds/ o es un enlace simbólico")

    selected = [worlds]
    selected.extend(worlds.rglob("*"))
    for name in CONFIG_FILES:
        config = root / name
        if config.is_symlink() or not config.is_file():
            raise RuntimeError(f"Falta un archivo de configuración: {config}")
        selected.append(config)
    for path in selected:
        if path.is_symlink() or not (path.is_dir() or path.is_file()):
            raise RuntimeError(f"Ruta ausente o no autorizada: {path}")

    files = sorted((p for p in selected if p.is_file()), key=lambda p: p.as_posix())
    if not any(p.relative_to(root).parts[0] == "worlds" for p in files):
        raise RuntimeError("No se encontraron archivos de mundos")
    return files


def create_backup(root, output, check_stopped=ensure_stopped):
    root = Path(root)
    output = Path(output)
    if root.is_symlink():
        raise RuntimeError("La raíz de Bedrock es un enlace simbólico")
    root = root.resolve(strict=True)
    if output.exists() or output.is_symlink():
        raise FileExistsError(output)
    if not output.parent.is_dir():
        raise RuntimeError("La carpeta de destino no existe")
    if output.parent.is_symlink():
        raise RuntimeError("La carpeta de destino es un enlace simbólico")
    if output.parent.resolve() == root or root in output.parent.resolve().parents:
        raise RuntimeError("El respaldo debe guardarse fuera de la instalación Bedrock")

    check_stopped()
    files = source_files(root)
    entries = [
        {
            "path": p.relative_to(root).as_posix(),
            "size": p.stat().st_size,
            "sha256": sha256_file(p),
        }
        for p in files
    ]
    manifest = {
        "format": 1,
        "created_utc": datetime.now(timezone.utc).isoformat(),
        "files": entries,
    }

    with tempfile.NamedTemporaryFile(
        prefix=".bedrock-backup-", suffix=".tar.gz", dir=output.parent, delete=False
    ) as temporary:
        temp_path = Path(temporary.name)
    os.chmod(temp_path, 0o600)

    try:
        with tarfile.open(temp_path, "w:gz") as archive:
            for path in files:
                archive.add(path, arcname=path.relative_to(root).as_posix(), recursive=False)
            raw_manifest = json.dumps(manifest, indent=2, sort_keys=True).encode("utf-8")
            info = tarfile.TarInfo(MANIFEST)
            info.size = len(raw_manifest)
            info.mode = 0o600
            archive.addfile(info, io.BytesIO(raw_manifest))

        verify_backup(temp_path)
        check_stopped()
        if os.name == "nt":
            temp_path.rename(output)
        else:
            os.link(temp_path, output)
        return {
            "archive": str(output),
            "sha256": sha256_file(output),
            "files": len(files),
        }
    finally:
        temp_path.unlink(missing_ok=True)


def verify_backup(archive_path):
    """Rechaza rutas peligrosas y comprueba cada archivo contra el manifiesto."""
    with tarfile.open(archive_path, "r:gz") as archive:
        members = archive.getmembers()
        names = [member.name for member in members]
        if len(names) != len(set(names)) or MANIFEST not in names:
            raise RuntimeError("Archivo duplicado o sin manifiesto")
        for member in members:
            path = PurePosixPath(member.name)
            if (
                path.is_absolute()
                or ".." in path.parts
                or "\\" in member.name
                or not member.isfile()
                or (
                    member.name != MANIFEST
                    and path.parts[0] != "worlds"
                    and member.name not in CONFIG_FILES
                )
            ):
                raise RuntimeError(f"Entrada no autorizada: {member.name}")

        manifest = json.load(archive.extractfile(MANIFEST))
        if manifest.get("format") != 1 or not isinstance(manifest.get("files"), list):
            raise RuntimeError("Formato de manifiesto inválido")
        expected = {entry["path"]: entry for entry in manifest["files"]}
        if set(expected) != set(names) - {MANIFEST}:
            raise RuntimeError("El manifiesto no coincide con el archivo")
        for name, entry in expected.items():
            digest = hashlib.sha256()
            size = 0
            with archive.extractfile(name) as source:
                for block in iter(lambda: source.read(1024 * 1024), b""):
                    size += len(block)
                    digest.update(block)
            if size != entry["size"] or digest.hexdigest() != entry["sha256"]:
                raise RuntimeError(f"Contenido distinto al manifiesto: {name}")
        return manifest


def restore_lab(archive_path, destination):
    """Restaura únicamente en una carpeta nueva, nunca encima de otra instalación."""
    destination = Path(destination)
    if destination.exists() or destination.is_symlink():
        raise FileExistsError(destination)
    if not destination.parent.is_dir() or destination.parent.is_symlink():
        raise RuntimeError("La carpeta padre del laboratorio no es válida")
    manifest = verify_backup(archive_path)
    destination.mkdir(mode=0o700)
    try:
        with tarfile.open(archive_path, "r:gz") as archive:
            for entry in manifest["files"]:
                target = destination.joinpath(*PurePosixPath(entry["path"]).parts)
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.extractfile(entry["path"]) as source, target.open("xb") as output:
                    shutil.copyfileobj(source, output)
        return len(manifest["files"])
    except BaseException:
        shutil.rmtree(destination)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    subcommands = parser.add_subparsers(dest="command", required=True)
    create = subcommands.add_parser("create", help="crear archivo si Bedrock está detenido")
    create.add_argument("--root", required=True, help="raíz de la instalación Bedrock")
    create.add_argument("--output", required=True, help="nuevo archivo .tar.gz")
    verify = subcommands.add_parser("verify", help="verificar hashes y rutas del archivo")
    verify.add_argument("archive")
    restore = subcommands.add_parser("restore-lab", help="restaurar en carpeta nueva")
    restore.add_argument("archive")
    restore.add_argument("destination")
    args = parser.parse_args()

    if args.command == "create":
        print(json.dumps(create_backup(args.root, args.output), indent=2))
    elif args.command == "verify":
        manifest = verify_backup(args.archive)
        print(f"OK: {len(manifest['files'])} archivos verificados")
    else:
        count = restore_lab(args.archive, args.destination)
        print(f"OK: {count} archivos restaurados en laboratorio")


if __name__ == "__main__":
    main()
