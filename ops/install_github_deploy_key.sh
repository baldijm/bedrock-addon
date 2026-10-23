#!/bin/sh
# Registra una clave pública de GitHub Actions con permisos mínimos.
set -eu

key_file=/tmp/bedrock_github_actions.pub
authorized=/home/azureuser/.ssh/authorized_keys

test -f "$key_file"
key=$(cat "$key_file")
case "$key" in
  ssh-ed25519\ *github-actions-bedrock-deploy) ;;
  *) echo 'La clave pública no tiene el formato esperado.' >&2; exit 1 ;;
esac

install -d -o azureuser -g azureuser -m 0700 /home/azureuser/.ssh
touch "$authorized"
chown azureuser:azureuser "$authorized"
chmod 0600 "$authorized"
line="restrict,command=\"/usr/local/sbin/bedrock-github-deploy\" $key"
grep -Fqx "$line" "$authorized" || printf '%s\n' "$line" >> "$authorized"
echo 'OK: clave de GitHub Actions restringida registrada.'
