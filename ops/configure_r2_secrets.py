#!/usr/bin/env python3
"""Solicita secretos en una terminal y los guarda fuera de Git, sin mostrarlos."""

import argparse
import getpass
import json
import os
from pathlib import Path
import re
import stat
import sys


DEFAULT_DIRECTORY = Path("/etc/bedrock-backup")


def prepare_directory(directory):
    directory = Path(directory)
    if directory.is_symlink():
        raise RuntimeError("La carpeta de secretos no puede ser un enlace simbólico")
    if not directory.exists():
        directory.mkdir(mode=0o700)
    metadata = directory.stat(follow_symlinks=False)
    if not stat.S_ISDIR(metadata.st_mode) or stat.S_IMODE(metadata.st_mode) != 0o700:
        raise RuntimeError("La carpeta de secretos debe tener permisos 0700")
    if hasattr(os, "geteuid") and metadata.st_uid != os.geteuid():
        raise RuntimeError("La carpeta de secretos debe pertenecer al usuario actual")
    target = directory / "r2.json"
    if target.exists() or target.is_symlink():
        raise FileExistsError("La configuración ya existe; no se sobrescribirá")
    return target


def write_config(target, config):
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(target, flags, 0o600)
    try:
        if hasattr(os, "fchmod"):
            os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as destination:
            descriptor = -1
            json.dump(config, destination, ensure_ascii=False)
            destination.write("\n")
            destination.flush()
            os.fsync(destination.fileno())
        if hasattr(os, "O_DIRECTORY"):
            folder = os.open(target.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(folder)
            finally:
                os.close(folder)
    except BaseException:
        if descriptor != -1:
            os.close(descriptor)
        target.unlink(missing_ok=True)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--account-id", required=True)
    parser.add_argument("--bucket", required=True)
    parser.add_argument("--directory", type=Path, default=DEFAULT_DIRECTORY)
    args = parser.parse_args()
    if not re.fullmatch(r"[0-9a-f]{32}", args.account_id):
        parser.error("account-id debe contener 32 caracteres hexadecimales")
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{1,61}[a-z0-9]", args.bucket):
        parser.error("nombre de bucket inválido")
    if not hasattr(os, "geteuid") or os.geteuid() != 0:
        parser.error("ejecutar como root para proteger el archivo de secretos")
    try:
        with open("/dev/tty", "r", encoding="utf-8"):
            pass
    except OSError:
        parser.error("se necesita una terminal interactiva; no usar tuberías")

    target = prepare_directory(args.directory)
    access_key_id = getpass.getpass("Access Key ID de R2: ")
    secret_access_key = getpass.getpass("Secret Access Key de R2: ")
    password = getpass.getpass("Contraseña de cifrado restic: ")
    confirmation = getpass.getpass("Repetir contraseña de cifrado: ")
    if not access_key_id or not secret_access_key or len(password) < 24:
        raise RuntimeError("Falta una clave o la contraseña de cifrado tiene menos de 24 caracteres")
    if password != confirmation:
        raise RuntimeError("Las contraseñas de cifrado no coinciden")
    if password == secret_access_key:
        raise RuntimeError("La contraseña de cifrado debe ser distinta de la clave R2")

    write_config(
        target,
        {
            "account_id": args.account_id,
            "bucket": args.bucket,
            "access_key_id": access_key_id,
            "secret_access_key": secret_access_key,
            "restic_password": password,
        },
    )
    print("OK: configuración privada guardada; no se creó ni subió ningún respaldo.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
