#!/bin/sh
# Instala la unidad del túnel de la consola de staging. No toca producción.
set -eu

if ! command -v cloudflared >/dev/null 2>&1; then
  echo 'Falta cloudflared; instala primero el paquete oficial para esta arquitectura.' >&2
  exit 1
fi

if ! getent passwd cloudflared >/dev/null; then
  useradd --system --home-dir /var/lib/cloudflared --create-home --shell /usr/sbin/nologin cloudflared
fi

install -d -o root -g cloudflared -m 0750 /etc/cloudflared
if [ ! -f /etc/cloudflared/spb-staging-bridge.env ]; then
  echo 'Falta /etc/cloudflared/spb-staging-bridge.env; no se instaló la unidad.' >&2
  exit 1
fi
chown root:cloudflared /etc/cloudflared/spb-staging-bridge.env
chmod 0640 /etc/cloudflared/spb-staging-bridge.env
install -o root -g root -m 0644 /tmp/cloudflared-spb-staging-bridge.service /etc/systemd/system/cloudflared-spb-staging-bridge.service
systemctl daemon-reload
echo 'OK: unidad del túnel instalada. Iníciala sólo tras comprobar el bridge local.'
