#!/bin/sh
# Instala el bridge de consola y la unidad de staging. No toca producción.
set -eu

install -d -o root -g root -m 0755 /usr/local/lib/spb
install -o root -g root -m 0755 /tmp/bedrock_console_bridge.py /usr/local/lib/spb/bedrock-console-bridge.py
install -o root -g root -m 0644 /tmp/bedrock-staging.service /etc/systemd/system/bedrock-staging.service
install -d -o root -g root -m 0700 /etc/bedrock-staging-console
if [ ! -f /etc/bedrock-staging-console/bridge.env ]; then
  echo 'Falta /etc/bedrock-staging-console/bridge.env; no se modificó el servicio.' >&2
  exit 1
fi
chown root:root /etc/bedrock-staging-console/bridge.env
chmod 0600 /etc/bedrock-staging-console/bridge.env
systemctl daemon-reload
echo 'OK: bridge de staging instalado. Reinicia sólo bedrock-staging.service al aplicar la configuración.'
