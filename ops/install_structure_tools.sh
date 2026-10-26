#!/bin/sh
# Instala el extractor de estructuras con versiones bloqueadas. No toca mundos.
set -eu

install -d -o root -g root -m 0755 /usr/local/lib/spb/structure-tools
install -o root -g root -m 0644 /tmp/structure-tools/package.json /usr/local/lib/spb/structure-tools/package.json
install -o root -g root -m 0644 /tmp/structure-tools/package-lock.json /usr/local/lib/spb/structure-tools/package-lock.json
cd /usr/local/lib/spb/structure-tools
npm ci --omit=dev --ignore-scripts
chown -R root:root /usr/local/lib/spb/structure-tools
chmod -R a+rX /usr/local/lib/spb/structure-tools
echo 'OK: extractor de estructuras instalado.'
