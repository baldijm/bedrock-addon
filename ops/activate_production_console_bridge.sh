#!/bin/sh
# Activa el bridge de producción con reversión automática si no arranca.
set -eu

legacy=/etc/systemd/system/bedrock.service.legacy
candidate=/etc/systemd/system/bedrock.service.bridge
active=/etc/systemd/system/bedrock.service

test -f "$legacy"
test -f "$candidate"
systemctl stop bedrock.service
install -o root -g root -m 0644 "$candidate" "$active"
systemctl daemon-reload

if systemctl start spb-production-bridge.service && systemctl start bedrock.service; then
  systemctl is-active --quiet spb-production-bridge.service
  systemctl is-active --quiet bedrock.service
  echo 'OK: Bedrock de producción está controlado por el bridge persistente.'
  exit 0
fi

systemctl stop spb-production-bridge.service || true
install -o root -g root -m 0644 "$legacy" "$active"
systemctl daemon-reload
systemctl start bedrock.service
echo 'ERROR: no se pudo activar el bridge; se restauró la unidad anterior de Bedrock.' >&2
exit 1
