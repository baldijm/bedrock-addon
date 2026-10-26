#!/bin/sh
# Migra producción a un bridge persistente. No promueve, restaura ni reemplaza mundos.
set -eu

install -d -o root -g root -m 0755 /usr/local/lib/spb
install -o root -g root -m 0755 /tmp/bedrock_console_bridge.py /usr/local/lib/spb/bedrock-console-bridge.py
install -o root -g root -m 0755 /tmp/bedrock_production_control.py /usr/local/lib/spb/bedrock-production-control.py
install -o root -g root -m 0644 /tmp/spb-production-bridge.service /etc/systemd/system/spb-production-bridge.service
install -o root -g root -m 0644 /tmp/bedrock-production-bridge.service /etc/systemd/system/bedrock.service.bridge
if [ ! -f /etc/systemd/system/bedrock.service.legacy ]; then
  cp -p /etc/systemd/system/bedrock.service /etc/systemd/system/bedrock.service.legacy
fi

install -d -o root -g root -m 0700 /etc/bedrock-production-console
install -d -o bedrock -g bedrock -m 0700 /var/lib/spb/structure-exports
if [ -f /tmp/install_structure_tools.sh ]; then
  sh /tmp/install_structure_tools.sh
fi
if [ ! -f /etc/bedrock-production-console/bridge.env ]; then
  set -a
  . /etc/bedrock-production-observer/observer.env
  set +a
  test -n "${SPB_PRODUCTION_OBSERVER_TOKEN:-}"
  umask 077
  printf 'SPB_BRIDGE_TOKEN=%s\n' "$SPB_PRODUCTION_OBSERVER_TOKEN" > /etc/bedrock-production-console/bridge.env
fi
chown root:root /etc/bedrock-production-console/bridge.env
chmod 0600 /etc/bedrock-production-console/bridge.env

python3 -m py_compile /usr/local/lib/spb/bedrock-console-bridge.py /usr/local/lib/spb/bedrock-production-control.py
systemctl daemon-reload
systemctl enable spb-production-bridge.service
echo 'OK: archivos de bridge de producción instalados. La conmutación sigue pendiente; Bedrock continúa sin cambios.'
