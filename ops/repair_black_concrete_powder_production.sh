#!/usr/bin/env bash
# Apply the narrowly scoped black concrete powder atlas repair in Production.
set -euo pipefail

ROOT=/opt/bedrock
RP="$ROOT/resource_packs/SPB_RP"
BP="$ROOT/behavior_packs/SPB_BP"
WORLD="$ROOT/worlds/Forever World"
SOURCE_ATLAS=/tmp/terrain_texture.json
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP="$ROOT/backups/black-concrete-powder-texture-$STAMP"

python3 -m json.tool "$SOURCE_ATLAS" >/dev/null
test "$(python3 -c "import json; print(json.load(open('$SOURCE_ATLAS'))['texture_data']['black_concrete_powder']['textures'])")" = \
  "textures/blocks/spb_concrete_powder_black"
test -f "$RP/textures/blocks/spb_concrete_powder_black.png"

sudo install -d -m 0750 -o root -g root "$BACKUP"
for path in \
  "$RP/textures/terrain_texture.json" \
  "$RP/manifest.json" \
  "$BP/manifest.json" \
  "$WORLD/world_resource_packs.json" \
  "$WORLD/world_behavior_packs.json"; do
  sudo cp -a "$path" "$BACKUP/$(basename "$path")"
done

sudo install -o root -g root -m 0644 "$SOURCE_ATLAS" "$RP/textures/terrain_texture.json"
sudo python3 /tmp/bump_world_pack_versions.py "$BP/manifest.json" "$RP/manifest.json" "$WORLD"

echo "BACKUP=$BACKUP"
sudo systemctl restart bedrock.service
sudo systemctl is-active bedrock.service
sleep 8

python3 -c "import json; p='$RP/textures/terrain_texture.json'; m='$RP/manifest.json'; w='$WORLD/world_resource_packs.json'; print('ATLAS='+json.load(open(p))['texture_data']['black_concrete_powder']['textures']); print('RP_VERSION='+'.'.join(map(str,json.load(open(m))['header']['version']))); print('WORLD_RP_VERSION='+'.'.join(map(str,[x['version'] for x in json.load(open(w)) if x['pack_id']=='fcf0b286-097c-4888-bab9-443f550932ac'][0])))"
sudo journalctl -u bedrock.service -n 80 --no-pager | grep -E 'Server started|Accepting clients|Pack Stack|ERROR|Error' | tail -40 || true
