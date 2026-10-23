#!/bin/sh
# Instala únicamente las herramientas de despliegue; no toca Bedrock ni servicios.
set -eu

install -d -o root -g root -m 0700 /opt/bedrock-deploy
install -o root -g root -m 0700 /tmp/addon_deploy.py /opt/bedrock-deploy/addon_deploy.py
install -o root -g root -m 0700 /tmp/production_backup.py /opt/bedrock-deploy/production_backup.py
install -o root -g root -m 0700 /tmp/world_backup.py /opt/bedrock-deploy/world_backup.py
install -o root -g root -m 0700 /tmp/r2_lab.py /opt/bedrock-deploy/r2_lab.py
install -o root -g root -m 0600 /tmp/test_addon_deploy.py /opt/bedrock-deploy/test_addon_deploy.py
cd /opt/bedrock-deploy
python3 -m unittest test_addon_deploy.py
python3 -m py_compile addon_deploy.py production_backup.py world_backup.py r2_lab.py
echo 'OK: herramientas de despliegue instaladas y comprobadas.'
