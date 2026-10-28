#!/usr/bin/env python3
"""Safely sync SPB static blocks and their resource-pack assets.

Only ``*_fixed.json`` block definitions, the texture-atlas records referenced
by them, their actual image files, and their display names are copied.  World
data, scripts and unrelated pack assets are deliberately left untouched.
"""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path


IMAGE_EXTENSIONS = (".png", ".tga", ".jpg", ".jpeg")


def texture_paths(value: object) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        return [item for item in value if isinstance(item, str)]
    if isinstance(value, dict):
        path = value.get("path")
        return [path] if isinstance(path, str) else []
    return []


def copy_asset(source_rp: Path, target_rp: Path, texture_path: str) -> None:
    for extension in IMAGE_EXTENSIONS:
        source = source_rp / f"{texture_path}{extension}"
        if source.is_file():
            target = target_rp / f"{texture_path}{extension}"
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
            return
    raise FileNotFoundError(f"No existe la imagen para {texture_path}")


def language_value(language: str, key: str) -> str | None:
    prefix = f"{key}="
    for line in language.splitlines():
        if line.startswith(prefix):
            return line
    return None


def upsert_language(language: str, line: str) -> str:
    key = line.partition("=")[0]
    lines = [item for item in language.splitlines() if not item.startswith(f"{key}=")]
    lines.append(line)
    return "\n".join(lines) + "\n"


def main() -> int:
    if len(sys.argv) != 5:
        raise SystemExit(
            "Uso: sync_static_block_textures.py BP_ORIGEN RP_ORIGEN BP_DESTINO RP_DESTINO"
        )

    source_bp, source_rp, target_bp, target_rp = map(Path, sys.argv[1:])
    source_terrain_path = source_rp / "textures" / "terrain_texture.json"
    target_terrain_path = target_rp / "textures" / "terrain_texture.json"
    source_terrain = json.loads(source_terrain_path.read_text(encoding="utf-8"))
    target_terrain = json.loads(target_terrain_path.read_text(encoding="utf-8"))
    source_textures = source_terrain.get("texture_data", {})
    target_textures = target_terrain.setdefault("texture_data", {})
    source_language = (source_rp / "texts" / "en_US.lang").read_text(encoding="utf-8")
    target_language_path = target_rp / "texts" / "en_US.lang"
    target_language = target_language_path.read_text(encoding="utf-8")

    target_blocks = target_bp / "blocks"
    target_blocks.mkdir(parents=True, exist_ok=True)
    synced: list[str] = []
    for source_block in sorted((source_bp / "blocks").glob("*_fixed.json")):
        block = json.loads(source_block.read_text(encoding="utf-8"))
        minecraft_block = block["minecraft:block"]
        identifier = minecraft_block["description"]["identifier"]
        texture = minecraft_block["components"]["minecraft:material_instances"]["*"]["texture"]
        entry = source_textures.get(texture)
        paths = texture_paths(entry.get("textures")) if isinstance(entry, dict) else []
        if not paths:
            raise ValueError(f"{identifier} no tiene textura auditable en el RP origen")
        for path in paths:
            copy_asset(source_rp, target_rp, path)
        shutil.copy2(source_block, target_blocks / source_block.name)
        target_textures[texture] = entry
        line = language_value(source_language, f"tile.{identifier}.name")
        if line:
            target_language = upsert_language(target_language, line)
        synced.append(identifier)

    target_terrain_path.write_text(
        json.dumps(target_terrain, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    target_language_path.write_text(target_language, encoding="utf-8")
    print(f"SYNCED\tblocks={len(synced)}\tidentifiers={','.join(synced)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
