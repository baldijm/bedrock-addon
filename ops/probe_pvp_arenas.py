#!/usr/bin/env python3
"""Check the PvP console protocol without exposing bridge credentials.

Run on the VM as root. Mutating smoke checks are restricted to Staging and
only create/delete a configuration draft; they never place blocks or NPCs.
"""
import argparse
import json
import re
import time
import uuid
from pathlib import Path
from urllib.parse import quote, unquote
from urllib.request import Request, urlopen


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('environment', choices=['staging', 'production'])
    parser.add_argument('--exercise-staging', action='store_true')
    args = parser.parse_args()
    if args.exercise_staging and args.environment != 'staging':
        raise RuntimeError('Las pruebas de escritura se limitan a Staging.')
    env_file = Path(f'/etc/bedrock-{args.environment}-console/bridge.env')
    values = dict(line.split('=', 1) for line in env_file.read_text().splitlines() if '=' in line and not line.startswith('#'))
    token = values['SPB_BRIDGE_TOKEN'].strip().strip('\"').strip("'")
    base = f"http://127.0.0.1:{3002 if args.environment == 'staging' else 3004}"

    def http(path, body=None):
        request = Request(base + path, data=json.dumps(body).encode() if body is not None else None,
                          headers={'Authorization': token, 'content-type': 'application/json'})
        with urlopen(request, timeout=15) as response:
            return json.load(response)

    def command(input):
        request_id = uuid.uuid4().hex[:12]
        payload = quote(json.dumps(input, separators=(',', ':'), ensure_ascii=False), safe="~()*!.'-_")
        chunks = [payload[i:i + 350] for i in range(0, len(payload), 350)]
        cursor = 0
        for index, chunk in enumerate(chunks + ['COMMIT']):
            sent = http('/commands', {'command': f'scriptevent spb:pvp_admin {request_id} {index} {chunk}'})
            cursor = sent['outputCursor']
        parts = {}
        count = 0
        for _ in range(30):
            time.sleep(0.5)
            logs = http(f'/logs?after={cursor}')
            cursor = logs['cursor']
            for line in logs['lines']:
                match = re.search(rf'SPB_PVP {request_id} (\d+)/(\d+) (\S+)', line['text'])
                if match:
                    count = int(match[2])
                    parts[int(match[1])] = match[3]
            if count and len(parts) == count:
                return json.loads(unquote(''.join(parts[i] for i in range(count))))
        raise RuntimeError('El add-on no confirmó el protocolo PvP.')

    initial = command({'action': 'list'})
    assert initial['ok'], initial.get('error')
    state = initial['state']
    print(json.dumps({'environment': args.environment, 'revision': state['revision'], 'arenas': len(state['arenas']),
                      'active': state['active']['id'] if state['active'] else None, 'busy': initial['busy']}))
    if not args.exercise_staging:
        return
    assert not initial['busy'], 'Espera a que termine la partida de Staging.'
    arena = dict(state['arenas'][0])
    arena.update(id='dashboard-smoke-test', name='Prueba temporal Ñ 🏟️')
    assert not any(item['id'] == arena['id'] for item in state['arenas']), 'El borrador temporal ya existe.'
    # Test the unbuilt case high above the legacy arena; no blocks are placed.
    for key in ['p1', 'p2', 'returnPoint', 'npc1', 'npc2']:
        arena[key] = {**arena[key], 'y': 310}
    arena['bounds'] = {'min': {**arena['bounds']['min'], 'y': 290}, 'max': {**arena['bounds']['max'], 'y': 319}}
    for key in ['goal1', 'goal2']:
        arena[key] = {'min': {**arena[key]['min'], 'y': 300}, 'max': {**arena[key]['max'], 'y': 302}}
    saved = command({'action': 'save', 'revision': state['revision'], 'arena': arena})
    assert saved['ok'], saved.get('error')
    revision = saved['state']['revision']
    try:
        stale = command({'action': 'save', 'revision': state['revision'], 'arena': arena})
        assert not stale['ok'], 'Debe rechazar escrituras con revisión antigua.'
        activation = command({'action': 'activate', 'revision': revision, 'id': arena['id']})
        assert not activation['ok'], 'Una arena sin suelo no debe activarse.'
        assert 'suelo' in activation.get('error', '').lower() or 'loaded' in activation.get('error', '').lower(), activation.get('error')
        print('PASS: borrador Unicode, revisión antigua rechazada, activación sin suelo rechazada.')
    finally:
        current = command({'action': 'list'})['state']
        if current['active'] and current['active']['id'] == arena['id']:
            current = command({'action': 'deactivate', 'revision': current['revision']})['state']
        deleted = command({'action': 'delete', 'revision': current['revision'], 'id': arena['id']})
        assert deleted['ok'], deleted.get('error')
        print('PASS: borrador temporal eliminado; construcción y NPC sin modificar.')


if __name__ == '__main__':
    main()
