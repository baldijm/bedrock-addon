#!/usr/bin/env python3
"""Populate the RP assets required by custom non-gravity static blocks.

The block files are the source of truth. Each fixed block using a vanilla
texture key gets an SPB-owned PNG copied from Mojang's public vanilla sample
pack, and its terrain atlas entry points to that local asset.
"""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path
from urllib.request import urlopen


SOURCE = "https://raw.githubusercontent.com/Mojang/bedrock-samples/main/resource_pack/textures/blocks/{name}.png"


def main() -> int:
    if len(sys.argv) != 3:
        raise SystemExit("Uso: repair_static_block_textures.py BEHAVIOR_PACK RESOURCE_PACK")

    behavior_pack = Path(sys.argv[1])
    resource_pack = Path(sys.argv[2])
    terrain_path = resource_pack / "textures" / "terrain_texture.json"
    language_path = resource_pack / "texts" / "en_US.lang"
    texture_dir = resource_pack / "textures" / "blocks"
    terrain = json.loads(terrain_path.read_text(encoding="utf-8"))
    texture_data = terrain.setdefault("texture_data", {})
    language = language_path.read_text(encoding="utf-8")
    texture_dir.mkdir(parents=True, exist_ok=True)

    repaired = []
    for block_path in sorted((behavior_pack / "blocks").glob("*_fixed.json")):
        block = json.loads(block_path.read_text(encoding="utf-8"))
        minecraft_block = block["minecraft:block"]
        identifier = minecraft_block["description"]["identifier"]
        material = minecraft_block["components"].get("minecraft:material_instances", {}).get("*", {})
        source_name = material.get("texture")
        if not isinstance(source_name, str) or source_name.startswith("spb_"):
            continue

        target_name = f"spb_{source_name}"
        target = texture_dir / f"{target_name}.png"
        if not target.is_file():
            with urlopen(SOURCE.format(name=source_name), timeout=30) as response:
                with target.open("wb") as output:
                    shutil.copyfileobj(response, output)

        texture_data[source_name] = {"textures": f"textures/blocks/{target_name}"}
        label = identifier.removeprefix("spb:").removesuffix("_fixed").replace("_", " ") + " fijo"
        language_key = f"tile.{identifier}.name="
        if language_key not in language:
            language += f"\n{language_key}{label}\n"
        repaired.append((identifier, source_name, target.name))

    terrain_path.write_text(json.dumps(terrain, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    language_path.write_text(language, encoding="utf-8")
    for identifier, source_name, target_name in repaired:
        print(f"REPAIRED\t{identifier}\t{source_name}\t{target_name}")
    print(f"SUMMARY\trepaired={len(repaired)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
