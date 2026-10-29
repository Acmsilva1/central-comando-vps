"""Testes locais do contrato do coletor; não acessam Docker ou VPS."""
import json
import types
import unittest
from unittest.mock import patch
import collect_metrics as collector


class CollectorTests(unittest.TestCase):
    def test_docker_units(self):
        self.assertEqual(collector.size('1.5GiB'), 1610612736)
        self.assertEqual(collector.size('32.5MB'), 32500000)
        self.assertEqual(collector.size('8unknown'), 0)
        self.assertEqual(collector.pair('5MB / 2MiB'), (5000000, 2097152))
        self.assertEqual(collector.pair('--'), (0, 0))

    def test_stopped_container_placeholders(self):
        self.assertEqual(collector.numeric('--'), 0)
        self.assertEqual(collector.numeric('1.25%'), 1.25)
        self.assertEqual(collector.numeric(None), 0)

    def test_collect_whitelist_and_host_resources(self):
        raw = {'Id': 'abc123456789000', 'Name': '/service', 'Config': {
            'Image': 'service:1', 'Env': ['SECRET=must-not-leak'],
            'Labels': {'com.docker.compose.project': 'apps', 'secret': 'must-not-leak'}},
            'HostConfig': {'Memory': 0}, 'RestartCount': 2,
            'State': {'Status': 'running', 'Health': {'Status': 'healthy', 'Log': ['must-not-leak']},
                      'StartedAt': '2026-10-28T00:00:00Z', 'OOMKilled': False}}
        stat = {'Name': 'service', 'CPUPerc': '2.5%', 'MemUsage': '64MiB / 2GiB',
                'NetIO': '1MB / 2MB', 'BlockIO': '3MB / 4MB', 'PIDs': '7'}

        def docker(*args):
            if args[0] == 'ps':
                return 'abc123456789000\n'
            return json.dumps([raw]) if args[0] == 'inspect' else json.dumps(stat)

        def read(path, *args, **kwargs):
            return {'/proc/meminfo': 'MemTotal: 2000 kB\nMemAvailable: 1000 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB',
                    '/proc/uptime': '3600.0 100.0',
                    '/proc/net/dev': 'header\nheader\n eth0: 10 0 0 0 0 0 0 0 20 0 0 0 0 0 0 0\n lo: 90 0 0 0 0 0 0 0 90\n veth0: 90 0 0 0 0 0 0 0 90'}[str(path).replace('\\', '/')]

        with patch.object(collector, 'docker', side_effect=docker), \
             patch.object(collector, 'cpu_ticks', side_effect=[(100, 50), (200, 125)]), \
             patch.object(collector.time, 'sleep'), patch.object(collector.pathlib.Path, 'read_text', read), \
             patch.object(collector.shutil, 'disk_usage', return_value=types.SimpleNamespace(total=1000, used=600)), \
             patch.object(collector.os, 'getloadavg', return_value=(0.1, 0.2, 0.3), create=True):
            snapshot = collector.collect()
        self.assertEqual(snapshot['host']['cpuPercent'], 25)
        self.assertEqual(snapshot['host']['memoryAvailable'], 1024000)
        self.assertEqual(snapshot['host']['networkRx'], 10)
        self.assertEqual(snapshot['host']['networkTx'], 20)
        self.assertEqual(snapshot['host']['diskUsed'], 600)
        self.assertEqual(snapshot['containers'][0]['memoryUsed'], 67108864)
        self.assertIsNone(snapshot['containers'][0]['memoryLimit'])
        self.assertNotIn('must-not-leak', json.dumps(snapshot))
        self.assertNotIn('Env', json.dumps(snapshot))


if __name__ == '__main__':
    unittest.main()
