import { readFile, stat, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
const finite = (n, fallback = 0) => Number.isFinite(Number(n)) ? Math.max(0, Number(n)) : fallback;
const text = (s, max = 160) => String(s ?? '').slice(0, max);
const percent = n => Math.min(100, finite(n));
const numeric = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
async function readJson(file, maxBytes) {
  if ((await stat(file)).size > maxBytes) throw new Error('metrics_file_too_large');
  const content = await readFile(file, 'utf8');
  if (Buffer.byteLength(content) > maxBytes) throw new Error('metrics_file_too_large');
  return JSON.parse(content);
}
export function normalizeSnapshot(input, now = Date.now()) {
  if (!input || input.version !== 1 || !Array.isArray(input.containers) || !input.host || Array.isArray(input.host)) throw new Error('invalid_snapshot');
  const sampled = Date.parse(input.sampledAt);
  if (!Number.isFinite(sampled) || sampled > now + 30_000) throw new Error('invalid_timestamp');
  const h = input.host;
  if (!['cpuCount','cpuPercent','memoryTotal','memoryAvailable','diskTotal','diskUsed'].every(key => numeric(h[key])) ||
      h.cpuCount < 1 || h.memoryTotal === 0 || h.diskTotal === 0 || input.containers.some(c => !c || typeof c !== 'object' || Array.isArray(c))) throw new Error('invalid_snapshot');
  const available = Math.min(h.memoryTotal, h.memoryAvailable), diskUsed = Math.min(h.diskTotal, h.diskUsed);
  return {
    version: 1, sampledAt: new Date(sampled).toISOString(), source: 'host-collector', stale: now - sampled > 60_000,
    host: {
      name: text(h.name), cpuCount: finite(h.cpuCount), cpuPercent: percent(h.cpuPercent),
      memoryTotal: h.memoryTotal, memoryAvailable: available,
      memoryUsed: h.memoryTotal - available,
      memoryPercent: percent((h.memoryTotal - available) / h.memoryTotal * 100),
      diskTotal: h.diskTotal, diskUsed, diskPercent: percent(diskUsed / h.diskTotal * 100),
      swapTotal: finite(h.swapTotal), swapUsed: finite(h.swapUsed), uptime: finite(h.uptime),
      load1: finite(h.load1), networkRx: finite(h.networkRx), networkTx: finite(h.networkTx)
    },
    containers: input.containers.slice(0, 200).map(c => ({
      id: text(c.id, 12), name: text(c.name, 100), image: text(c.image),
      state: ['running','exited','paused','restarting','created','dead','removing'].includes(c.state) ? c.state : 'unknown',
      health: ['healthy','unhealthy','starting'].includes(c.health) ? c.health : 'not-configured', cpuPercent: finite(c.cpuPercent), memoryUsed: finite(c.memoryUsed),
      memoryLimit: c.memoryLimit > 0 ? finite(c.memoryLimit) : null, networkRx: finite(c.networkRx), networkTx: finite(c.networkTx),
      blockRead: finite(c.blockRead), blockWrite: finite(c.blockWrite), pids: finite(c.pids), restarts: finite(c.restarts),
      startedAt: Number.isFinite(Date.parse(c.startedAt)) ? new Date(c.startedAt).toISOString() : null,
      oomKilled: c.oomKilled === true, project: text(c.project, 80)
    }))
  };
}
export function createMetrics({ file, historyFile, demo = false, now = Date.now }) {
  let history = [], loaded = false, collecting = false, latest = null, historyDirty = false, historyError = false;
  async function load() {
    if (loaded) return;
    loaded = true;
    if (demo || !historyFile) return;
    try {
      const saved = await readJson(historyFile, 32 * 1024 * 1024);
      if (Array.isArray(saved)) history = saved.filter(p => p && numeric(p.at) && p.at > now() - 7 * 86400_000 && p.at <= now() &&
        ['cpu','memory','disk'].every(key => numeric(p[key]))).map(p => ({
          at:p.at, cpu:percent(p.cpu), memory:percent(p.memory), disk:percent(p.disk),
          containers:Array.isArray(p.containers) ? p.containers.filter(c => c && typeof c === 'object').slice(0,200).map(c => ({name:text(c.name,100),memory:finite(c.memory),cpu:finite(c.cpu)})) : []
        })).sort((a,b) => a.at - b.at).filter((p,index,all) => index === 0 || p.at !== all[index-1].at).slice(-10080);
    } catch (error) { if (error.code !== 'ENOENT') console.error('Historico indisponivel; iniciando nova serie.'); }
  }
  async function collect() {
    if (collecting) return;
    collecting = true;
    try {
      await load();
      latest = normalizeSnapshot(demo ? demoSnapshot(now()) : await readJson(file, 2 * 1024 * 1024), now());
      latest.source = demo ? 'demo' : 'host-collector';
      if (!latest.stale && (!history.length || Date.parse(latest.sampledAt) - history.at(-1).at >= 60_000)) {
        history.push({ at: Date.parse(latest.sampledAt), cpu: latest.host.cpuPercent, memory: latest.host.memoryPercent, disk: latest.host.diskPercent,
          containers: latest.containers.map(c => ({ name: c.name, memory: c.memoryUsed, cpu: c.cpuPercent })) });
        history = history.filter(p => p.at > now() - 7 * 86400_000).slice(-10080);
        historyDirty = true;
      }
      if (!demo && historyFile && historyDirty) {
        try {
          await mkdir(dirname(historyFile), { recursive: true });
          await writeFile(`${historyFile}.tmp`, JSON.stringify(history), { mode: 0o600 });
          await rename(`${historyFile}.tmp`, historyFile);
          historyDirty = false;
          historyError = false;
        } catch {
          if (!historyError) console.error('Falha ao persistir historico; novas tentativas na proxima coleta.');
          historyError = true;
        }
      }
    } catch { if (latest) latest.stale = true; }
    finally { collecting = false; }
  }
  return {
    collect,
    snapshot() {
      if (!latest) return null;
      return { ...latest, historyAvailable: !historyError, stale: latest.stale || now() - Date.parse(latest.sampledAt) > 60_000 };
    },
    history(period = '1h') {
      const duration = { '1h': 3600_000, '6h': 21600_000, '24h': 86400_000, '7d': 604800_000 }[period] || 3600_000;
      return history.filter(p => p.at >= now() - duration).map(p => ({ ...p, containers:p.containers.map(c => ({...c})) }));
    }
  };
}
export function demoSnapshot(now = Date.now()) {
  const wave = Math.sin(now / 25000);
  return { version: 1, sampledAt: new Date(now).toISOString(), host: {
    name: 'vps-demonstracao', cpuCount: 1, cpuPercent: 4 + wave * 2, memoryTotal: 2063597568, memoryAvailable: 900000000 + wave * 20000000,
    diskTotal: 40802189312, diskUsed: 27000000000, swapTotal: 0, swapUsed: 0, uptime: 154800, load1: 0.08, networkRx: 184000000, networkTx: 92000000
  }, containers: [
    { name: 'mensageria-worker', image: 'mensageria-worker:local', memoryUsed: 626000000, cpuPercent: 1.2 + wave * .4, project: 'mensageria', pids: 162 },
    { name: 'mensageria-painel', image: 'mensageria-painel:local', memoryUsed: 43000000, cpuPercent: .1, project: 'mensageria', pids: 11 },
    { name: 'super-app', image: 'superapp-super-app', memoryUsed: 65000000, memoryLimit: 536870912, health: 'healthy', cpuPercent: .2, project: 'superapp', pids: 12 }
  ].map((c,i) => ({ ...c, id: `demo-${i}`, state: 'running', health: c.health || 'not-configured', restarts: 0, startedAt: new Date(now - 82800_000).toISOString(), networkRx: 4200000, networkTx: 1200000, blockRead: 400000, blockWrite: 100000 })) };
}
