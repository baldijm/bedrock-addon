#!/usr/bin/env python3
"""Increment SPB BP/RP patch versions and update one world's pack references."""

from __future__ import annotations

import json
import sys
from pathlib import Path


def read(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def write(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def increment(version: list[int]) -> list[int]:
    if len(version) != 3 or not all(isinstance(item, int) for item in version):
        raise ValueError(f"Versión inválida: {version!r}")
    return [version[0], version[1], version[2] + 1]


def main() -> int:
    if len(sys.argv) != 4:
        raise SystemExit("Uso: bump_world_pack_versions.py BP RP DIRECTORIO_MUNDO")
    bp_path, rp_path, world = map(Path, sys.argv[1:])
    bp = read(bp_path)
    rp = read(rp_path)
    bp_version = increment(bp["header"]["version"])
    rp_version = increment(rp["header"]["version"])
    bp_id = bp["header"]["uuid"]
    rp_id = rp["header"]["uuid"]

    bp["header"]["version"] = bp_version
    for module in bp.get("modules", []):
        module["version"] = bp_version
    for dependency in bp.get("dependencies", []):
        if dependency.get("uuid") == rp_id:
            dependency["version"] = rp_version

    rp["header"]["version"] = rp_version
    for module in rp.get("modules", []):
        module["version"] = rp_version

    world_bp_path = world / "world_behavior_packs.json"
    world_rp_path = world / "world_resource_packs.json"
    world_bp = read(world_bp_path)
    world_rp = read(world_rp_path)
    for entry in world_bp:
        if entry.get("pack_id") == bp_id:
            entry["version"] = bp_version
    for entry in world_rp:
        if entry.get("pack_id") == rp_id:
            entry["version"] = rp_version

    write(bp_path, bp)
    write(rp_path, rp)
    write(world_bp_path, world_bp)
    write(world_rp_path, world_rp)
    print(f"VERSIONS\tBP={'.'.join(map(str, bp_version))}\tRP={'.'.join(map(str, rp_version))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
