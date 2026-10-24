#!/bin/sh
# Instala el observador y el promotor de mundos; no inicia ninguna promoción.
set -eu

install -d -o root -g root -m 0755 /usr/local/lib/spb
install -o root -g root -m 0755 /tmp/bedrock_production_observer.py /usr/local/lib/spb/bedrock-production-observer.py
install -o root -g root -m 0755 /tmp/production_world_promote.py /usr/local/lib/spb/production-world-promote.py
install -o root -g root -m 0644 /tmp/spb-production-world-promote@.service /etc/systemd/system/spb-production-world-promote@.service
test -f /etc/bedrock-production-observer/observer.env
python3 -m py_compile /usr/local/lib/spb/bedrock-production-observer.py /usr/local/lib/spb/production-world-promote.py
systemctl daemon-reload
systemctl restart spb-production-observer.service
echo 'OK: gestión de promoción instalada; no se promovió ningún mundo.'
