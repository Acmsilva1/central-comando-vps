#!/usr/bin/env python3
"""Coleta local somente em leitura; publica um snapshot sem envs, logs ou credenciais."""
import argparse
import datetime
import json
import os
import pathlib
import shutil
import socket
import subprocess
import tempfile
import time


def docker(*args):
    result = subprocess.run(['docker', *args], check=True, capture_output=True, text=True, timeout=12)
    return result.stdout


def size(value):
    import re
    match = re.fullmatch(r'\s*([\d.]+)\s*([a-zA-Z]*)\s*', str(value))
    if not match:
        return 0
    units = {'b': 1, 'kb': 1000, 'mb': 1000**2, 'gb': 1000**3, 'tb': 1000**4,
             'kib': 1024, 'mib': 1024**2, 'gib': 1024**3, 'tib': 1024**4}
    return int(float(match[1]) * units.get(match[2].lower(), 0))


def pair(value):
    pieces = str(value or '0B / 0B').split('/')
    return (size(pieces[0]), size(pieces[1]) if len(pieces) > 1 else 0)


def numeric(value):
    try:
        return max(0, float(str(value).rstrip('%')))
    except (TypeError, ValueError):
        return 0


def cpu_ticks():
    ticks = list(map(int, pathlib.Path('/proc/stat').read_text().splitlines()[0].split()[1:9]))
    return sum(ticks), ticks[3] + ticks[4]


def collect():
    before = cpu_ticks()
    time.sleep(.2)
    after = cpu_ticks()
    delta = after[0] - before[0]
    cpu = 100 * (1 - (after[1] - before[1]) / delta) if delta else 0
    memory = {line.split(':')[0]: int(line.split()[1]) * 1024
              for line in pathlib.Path('/proc/meminfo').read_text().splitlines() if 'kB' in line}
    disk = shutil.disk_usage('/')
    rx, tx = 0, 0
    for line in pathlib.Path('/proc/net/dev').read_text().splitlines()[2:]:
        interface, values = line.split(':', 1)
        # Não soma bridges, veths e loopback para evitar contar tráfego várias vezes.
        if interface.strip().startswith(('eth', 'en', 'wl')):
            fields = values.split()
            rx += int(fields[0])
            tx += int(fields[8])
    ids = docker('ps', '-aq').split()
    inspections = json.loads(docker('inspect', *ids)) if ids else []
    stats = {}
    if ids:
        output = docker('stats', '--no-stream', '--format', '{{json .}}', *ids)
        for line in output.splitlines():
            stat = json.loads(line)
            stats[stat.get('Name')] = stat
    containers = []
    for c in inspections:
        name = c['Name'].lstrip('/')
        stat = stats.get(name, {})
        state = c['State']
        labels = c['Config'].get('Labels') or {}
        mem, _ = pair(stat.get('MemUsage'))
        network_rx, network_tx = pair(stat.get('NetIO'))
        block_read, block_write = pair(stat.get('BlockIO'))
        containers.append({
            'id': c['Id'][:12], 'name': name, 'image': c['Config']['Image'],
            'state': state['Status'], 'health': state.get('Health', {}).get('Status', 'not-configured'),
            'cpuPercent': numeric(stat.get('CPUPerc', '0%')),
            'memoryUsed': mem, 'memoryLimit': c['HostConfig'].get('Memory') or None,
            'pids': int(numeric(stat.get('PIDs', '0'))), 'restarts': c['RestartCount'],
            'networkRx': network_rx, 'networkTx': network_tx, 'blockRead': block_read, 'blockWrite': block_write,
            'startedAt': state.get('StartedAt'), 'oomKilled': state.get('OOMKilled', False),
            'project': labels.get('com.docker.compose.project', '')
        })
    return {'version': 1, 'sampledAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'host': {
        'name': socket.gethostname(), 'cpuCount': os.cpu_count(), 'cpuPercent': round(cpu, 2),
        'memoryTotal': memory['MemTotal'], 'memoryAvailable': memory.get('MemAvailable', memory.get('MemFree', 0)),
        'swapTotal': memory.get('SwapTotal', 0), 'swapUsed': memory.get('SwapTotal', 0) - memory.get('SwapFree', 0),
        'diskTotal': disk.total, 'diskUsed': disk.used,
        'uptime': float(pathlib.Path('/proc/uptime').read_text().split()[0]), 'load1': os.getloadavg()[0],
        'networkRx': rx, 'networkTx': tx
    }, 'containers': containers}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', help='Diretório exclusivo para o snapshot sanitizado')
    args = parser.parse_args()
    snapshot = collect()
    if not args.output:
        print(json.dumps(snapshot, ensure_ascii=False))
        return
    folder = pathlib.Path(args.output)
    folder.mkdir(mode=0o755, parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.snapshot-', dir=folder)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            json.dump(snapshot, stream, ensure_ascii=False)
        os.chmod(temporary, 0o644)
        os.replace(temporary, folder / 'snapshot.json')
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


if __name__ == '__main__':
    main()
