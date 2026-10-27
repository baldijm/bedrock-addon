#!/bin/sh
# Instala el mecanismo de actualización; no actualiza ni reinicia Bedrock.
set -eu

install -d -o root -g root -m 0755 /usr/local/lib/spb
install -o root -g root -m 0755 /tmp/bedrock_update.py /usr/local/lib/spb/bedrock-update.py
install -o root -g root -m 0644 /tmp/spb-staging-bedrock-update@.service /etc/systemd/system/spb-staging-bedrock-update@.service
visudo -cf /tmp/spb-staging-bedrock-update
install -o root -g root -m 0440 /tmp/spb-staging-bedrock-update /etc/sudoers.d/spb-staging-bedrock-update
install -d -o bedrock -g bedrock -m 0700 /var/lib/spb/bedrock-update/requests
install -d -o bedrock -g bedrock -m 0750 /var/lib/spb/bedrock-update/status
install -d -o root -g root -m 0700 /var/lib/spb/bedrock-update/work
python3 -m py_compile /usr/local/lib/spb/bedrock-update.py
systemctl daemon-reload
echo 'OK: actualizador Bedrock instalado; ningún servidor fue actualizado ni reiniciado.'
