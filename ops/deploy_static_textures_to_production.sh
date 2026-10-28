#!/usr/bin/env bash
# Deploy only the audited static-block support to Production.
# It intentionally never reads or writes level.dat, db/, player data or terrain.
set -euo pipefail

SOURCE_BP=/opt/bedrock-staging/behavior_packs/SPB_BP
SOURCE_RP=/opt/bedrock-staging/resource_packs/SPB_RP
TARGET_ROOT=/opt/bedrock
TARGET_BP="$TARGET_ROOT/behavior_packs/SPB_BP"
TARGET_RP="$TARGET_ROOT/resource_packs/SPB_RP"
WORLD="$TARGET_ROOT/worlds/Forever World"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP="$TARGET_ROOT/backups/static-texture-stable-$STAMP"

python3 /tmp/audit_static_block_textures.py "$SOURCE_BP" "$SOURCE_RP"

install -d -m 0750 -o root -g root "$BACKUP"
for path in \
  "$TARGET_BP/manifest.json" \
  "$TARGET_RP/manifest.json" \
  "$TARGET_RP/textures/terrain_texture.json" \
  "$TARGET_RP/texts/en_US.lang" \
  "$WORLD/world_behavior_packs.json" \
  "$WORLD/world_resource_packs.json" \
  "$TARGET_ROOT/server.properties"; do
  cp -a --parents "$path" "$BACKUP"
done

python3 /tmp/sync_static_block_textures.py "$SOURCE_BP" "$SOURCE_RP" "$TARGET_BP" "$TARGET_RP"
python3 /tmp/bump_world_pack_versions.py "$TARGET_BP/manifest.json" "$TARGET_RP/manifest.json" "$WORLD"

if grep -q '^texturepack-required=' "$TARGET_ROOT/server.properties"; then
  sed -i 's/^texturepack-required=.*/texturepack-required=true/' "$TARGET_ROOT/server.properties"
else
  printf '\ntexturepack-required=true\n' >> "$TARGET_ROOT/server.properties"
fi

chown -R bedrock:bedrock "$TARGET_BP/blocks" "$TARGET_RP/textures/blocks"
chown bedrock:bedrock \
  "$TARGET_BP/manifest.json" \
  "$TARGET_RP/manifest.json" \
  "$TARGET_RP/textures/terrain_texture.json" \
  "$TARGET_RP/texts/en_US.lang" \
  "$WORLD/world_behavior_packs.json" \
  "$WORLD/world_resource_packs.json" \
  "$TARGET_ROOT/server.properties"

python3 /tmp/audit_static_block_textures.py "$TARGET_BP" "$TARGET_RP"
echo "BACKUP=$BACKUP"
echo "WORLD_DATA_UNTOUCHED=$WORLD/db and level.dat were not accessed"
systemctl restart bedrock.service
systemctl is-active bedrock.service
sleep 3
journalctl -u bedrock.service -n 120 --no-pager | grep -E 'Server started|Accepting clients|Pack Stack|ERROR|Error' | tail -40 || true
