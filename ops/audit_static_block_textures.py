#!/usr/bin/env python3
"""Audit custom static blocks against the active Bedrock resource pack.

Usage: audit_static_block_textures.py BEHAVIOR_PACK RESOURCE_PACK
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


def texture_paths(value: object) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        return [item for item in value if isinstance(item, str)]
    if isinstance(value, dict):
        path = value.get("path")
        return [path] if isinstance(path, str) else []
    return []


def has_asset(resource_pack: Path, path: str) -> bool:
    relative = resource_pack / f"{path}"
    return any(relative.with_suffix(extension).is_file() for extension in (".png", ".tga", ".jpg", ".jpeg"))


def main() -> int:
    if len(sys.argv) != 3:
        raise SystemExit("Uso: audit_static_block_textures.py BEHAVIOR_PACK RESOURCE_PACK")

    behavior_pack = Path(sys.argv[1])
    resource_pack = Path(sys.argv[2])
    terrain = json.loads((resource_pack / "textures" / "terrain_texture.json").read_text(encoding="utf-8"))
    texture_data = terrain.get("texture_data", {})
    failures = 0

    for block_path in sorted((behavior_pack / "blocks").glob("*_fixed.json")):
        block = json.loads(block_path.read_text(encoding="utf-8"))
        minecraft_block = block["minecraft:block"]
        identifier = minecraft_block["description"]["identifier"]
        instances = minecraft_block["components"].get("minecraft:material_instances", {})
        texture = instances.get("*", {}).get("texture")
        entry = texture_data.get(texture) if isinstance(texture, str) else None
        paths = texture_paths(entry.get("textures")) if isinstance(entry, dict) else []
        assets_ok = bool(paths) and all(has_asset(resource_pack, path) for path in paths)
        status = "OK" if assets_ok else "ERROR"
        print(f"{status}\t{identifier}\ttexture={texture or '-'}\tpaths={','.join(paths) or '-'}")
        failures += not assets_ok

    print(f"SUMMARY\tfailures={failures}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
