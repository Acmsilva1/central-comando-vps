import { readFile, stat, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
const numeric = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const safeName = value => String(value || 'serviço').replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 80);
const round = value => Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
const gib = value => `${round(Math.max(0, Number(value) || 0) / 1024 ** 3)} GB`;

async function jsonFile(file, limit) {
  if ((await stat(file)).size > limit) throw new Error('file_too_large');
  const content = await readFile(file, 'utf8');
  if (Buffer.byteLength(content) > limit) throw new Error('file_too_large');
  return JSON.parse(content);
}

export async function loadMonitorConfig(file) {
  const config = await jsonFile(file, 8192);
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('invalid_monitor_config');
  if (config.enabled === false) return null;
  const endpoint = new URL(config.endpoint);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.hash ||
      endpoint.pathname !== '/api/control' || endpoint.searchParams.get('action') !== 'event' ||
      [...endpoint.searchParams.keys()].some(key => key !== 'action') ||
      typeof config.token !== 'string' || config.token.length < 32 || config.token.length > 256 ||
      /[\r\n]/.test(config.token)) throw new Error('invalid_monitor_config');
  const project = config.project || 'central-comando-vps', audience = config.audience || '1';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(project) || !/^[a-zA-Z0-9][a-zA-Z0-9_:-]{0,79}$/.test(audience)) throw new Error('invalid_monitor_config');
  const reportHour = config.reportHour ?? 20, timeZone = config.timeZone || 'America/Sao_Paulo';
  if (!Number.isInteger(reportHour) || reportHour < 0 || reportHour > 23) throw new Error('invalid_report_hour');
  new Intl.DateTimeFormat('pt-BR', { timeZone }).format();
  return { endpoint: endpoint.href, token: config.token, project, audience, reportHour, timeZone };
}

function calendar(at, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(at).map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}
function clock(at, timeZone) { return new Date(at).toLocaleTimeString('pt-BR', { timeZone, hour: '2-digit', minute: '2-digit' }); }
function blank(now) { return { version: 1, startedAt: now, conditions: {}, containers: {}, pending: [], sentAt: [], days: {}, reports: {}, queueOverflow: 0 }; }

function validateState(state) {
  if (!state || state.version !== 1 || !numeric(state.startedAt) || !Array.isArray(state.pending) || state.pending.length > 128 ||
      !Array.isArray(state.sentAt) || !state.conditions || !state.containers || !state.days || !state.reports ||
      [state.conditions,state.containers,state.days,state.reports].some(value=>typeof value!=='object'||Array.isArray(value)) ||
      Object.keys(state.conditions).length > 1000 || Object.keys(state.containers).length > 200 || Object.keys(state.days).length > 14) throw new Error('invalid_monitor_state');
  for (const item of state.pending) {
    if (!item || !/^[a-f0-9-]{36}$/.test(item.id || '') || !['alert', 'report'].includes(item.type) ||
        typeof item.title !== 'string' || item.title.length > 120 || typeof item.message !== 'string' || item.message.length > 3500 ||
        !numeric(item.createdAt) || !numeric(item.nextAttemptAt) || !numeric(item.attempts) ||
        !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(item.project || '') || !/^[a-zA-Z0-9][a-zA-Z0-9_:-]{0,79}$/.test(item.audience || '')) throw new Error('invalid_monitor_queue');
  }
  for (const value of Object.values(state.conditions)) if (!value || typeof value.active !== 'boolean' || !numeric(value.since)) throw new Error('invalid_monitor_conditions');
  for (const value of Object.values(state.days)) if (!value || !numeric(value.samples) || !numeric(value.incidents) || !numeric(value.peakCpu) || !numeric(value.peakMemory) || !Array.isArray(value.containers)) throw new Error('invalid_monitor_day');
  return state;
}

export function createMonitor({ store, configFile, stateFile, now = Date.now, fetchImpl = fetch }) {
  let state, busy = false;
  async function save() {
    await mkdir(dirname(stateFile), { recursive: true, mode: 0o700 });
    await writeFile(`${stateFile}.tmp`, `${JSON.stringify(state)}\n`, { mode: 0o600 });
    await rename(`${stateFile}.tmp`, stateFile);
  }
  async function load() {
    if (state) return;
    try { state = validateState(await jsonFile(stateFile, 2 * 1024 * 1024)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; state = blank(now()); }
  }
  function condition(key, unhealthy, label, events, day, timestamp, hold = 0) {
    let item = state.conditions[key];
    if (!item) item = state.conditions[key] = { since: timestamp, active: false };
    if (unhealthy) {
      if (!item.pending) item.since = timestamp;
      item.pending = true;
      if (!item.active && timestamp - item.since >= hold) {
        item.active = true; day.incidents++; events.push(`ALERTA: ${label}`);
      }
    } else {
      if (item.active) events.push(`RECUPERADO: ${label}`);
      item.active = false; item.pending = false; item.since = timestamp;
    }
  }
  function enqueue(type, title, message, timestamp, config, date) {
    if (state.pending.length >= 128) { state.queueOverflow = (state.queueOverflow || 0) + 1; return false; }
    const id = randomUUID();
    state.pending.push({ id, type, date, project:config.project, audience:config.audience, title, message: `📊 Central de Comando\n\n${message}`.slice(0, 3500), createdAt: timestamp, nextAttemptAt: timestamp, attempts: 0 });
    if (type === 'report') state.reports[date] = { id, queuedAt: timestamp };
    return true;
  }
  async function tick() {
    if (busy) return { enabled: true, skipped: 'tick_running' };
    busy = true;
    try {
      let config;
      try { config = await loadMonitorConfig(configFile); } catch { return { enabled: false, reason: 'config_unavailable' }; }
      if (!config) return { enabled: false, reason: 'disabled' };
      try { await load(); } catch { return { enabled: true, error: 'state_unavailable' }; }
      const timestamp = now(), current = calendar(timestamp, config.timeZone), snapshot = store.snapshot();
      if (snapshot?.source === 'demo' || snapshot?.demo) return { enabled: false, reason: 'demo' };
      const sampled = Date.parse(snapshot?.sampledAt), fresh = snapshot && Number.isFinite(sampled) && timestamp - sampled <= MINUTE && sampled <= timestamp + 30_000 && !snapshot.stale;
      let day = state.days[current.date];
      if (!day) day = state.days[current.date] = { samples: 0, incidents: 0, peakCpu: 0, peakMemory: 0, firstAt: null, lastAt: null, diskFree: null, containers: [], lastSampleAt: null };
      const events = [];
      // Reinício/pausa do agendador não comprova uso alto durante todo o intervalo.
      if(numeric(state.lastTickAt) && timestamp-state.lastTickAt>90_000)for(const key of ['cpu','memory','disk'])if(state.conditions[key]&&!state.conditions[key].active)state.conditions[key].pending=false;
      state.lastTickAt=timestamp;
      condition('collector', !fresh && timestamp - state.startedAt > MINUTE, fresh ? 'Coleta de métricas voltou a atualizar.' : 'Coletor sem leitura atual há mais de 60 segundos.', events, day, timestamp);
      if (fresh) {
        const host = snapshot.host;
        if (day.lastSampleAt !== sampled) {
          day.samples++; day.peakCpu = Math.max(day.peakCpu, host.cpuPercent); day.peakMemory = Math.max(day.peakMemory, host.memoryPercent);
          day.firstAt ??= sampled; day.lastAt = sampled; day.lastSampleAt = sampled; day.diskFree = Math.max(0, host.diskTotal - host.diskUsed);
          day.containers = snapshot.containers.slice(0, 30).map(c => ({ name: safeName(c.name), running: c.state === 'running', healthy: c.health !== 'unhealthy' }));
        }
        for (const [key, value, label] of [['cpu', host.cpuPercent, 'CPU'], ['memory', host.memoryPercent, 'RAM'], ['disk', host.diskPercent, 'Disco']]) {
          // Histerese evita alternar alertas e recuperações em torno de 90%.
          const active = state.conditions[key]?.active;
          condition(key, value >= (active ? 85 : 90), `${label} em ${round(value)}%. ${active && value < 85 ? 'Uso abaixo de 85%.' : 'Referência crítica: 90% por 2 minutos.'}`, events, day, timestamp, 2 * MINUTE);
        }
        const seen = new Set();
        for (const container of snapshot.containers.slice(0, 200)) {
          const name = safeName(container.name), key = `container:${name}`, previous = Object.hasOwn(state.containers,name) ? state.containers[name] : null; seen.add(name);
          const abnormal = container.state !== 'running' || container.health === 'unhealthy';
          condition(`${key}:availability`, abnormal, abnormal ? `${name}: estado ${safeName(container.state)}, saúde ${safeName(container.health)}.` : `${name}: em execução e sem healthcheck falhando.`, events, day, timestamp);
          condition(`${key}:oom`, container.oomKilled === true, container.oomKilled ? `${name}: encerramento por falta de memória registrado.` : `${name}: sem encerramento por falta de memória na leitura atual.`, events, day, timestamp);
          condition(`${key}:missing`, false, `${name}: voltou à lista de containers.`, events, day, timestamp);
          const increased = previous && container.id === previous.id && container.restarts > previous.restarts;
          condition(`${key}:restart`, Boolean(increased), increased ? `${name}: reinícios aumentaram de ${previous.restarts} para ${container.restarts}.` : `${name}: sem novo reinício nesta coleta.`, events, day, timestamp);
          Object.defineProperty(state.containers,name,{value:{ id: container.id, restarts: container.restarts, lastSeen: timestamp },enumerable:true,configurable:true,writable:true});
        }
        for (const name of Object.keys(state.containers)) if (!seen.has(name)) condition(`container:${name}:missing`, true, `${name}: não aparece mais na lista de containers.`, events, day, timestamp);
        const retired = Object.keys(state.containers).filter(name=>!seen.has(name)).sort((a,b)=>state.containers[a].lastSeen-state.containers[b].lastSeen);
        for(const name of retired) if(Object.keys(state.containers).length>200 || timestamp-state.containers[name].lastSeen>8*DAY){
          delete state.containers[name];for(const suffix of ['availability','oom','missing','restart'])delete state.conditions[`container:${name}:${suffix}`];
        }
      } else {
        // Uma lacuna de coleta não prova uso crítico contínuo.
        for (const key of ['cpu', 'memory', 'disk']) if (state.conditions[key] && !state.conditions[key].active) state.conditions[key].pending = false;
      }
      if (events.length) {
        const summary = events.slice(0, 24).join('\n') + (events.length > 24 ? `\nMais ${events.length - 24} mudanças nesta coleta.` : '');
        enqueue('alert', 'Central VPS · alteração de estado', `${clock(timestamp, config.timeZone)} · ${current.date}\n${summary}\nLeitura observada; não representa teste de disponibilidade externa.`, timestamp, config);
      }
      if (current.hour >= config.reportHour && !state.reports[current.date]) {
        const observed = day.samples ? `${clock(day.firstAt, config.timeZone)}–${clock(day.lastAt, config.timeZone)}` : 'sem amostras atuais';
        const statuses = day.containers.length ? day.containers.map(c => `${c.name}: ${c.running && c.healthy ? 'em execução' : 'atenção'}`).join('\n') : 'Containers: sem leitura atual.';
        const peaks = day.samples ? `Pico de CPU: ${round(day.peakCpu)}%; RAM: ${round(day.peakMemory)}%.` : 'Picos de CPU e RAM: sem amostras atuais.';
        const message = `Relatório de ${current.date} (${config.timeZone})\nJanela observada: ${observed}; ${day.samples} amostras.\n${peaks}\nDisco livre na última leitura: ${day.diskFree == null ? 'sem leitura' : gib(day.diskFree)}.\nIncidentes detectados: ${day.incidents}.\n${statuses}\nO histórico começa após a implantação. Amostras não equivalem a disponibilidade; a VPS desligada não avisa por si mesma.`;
        enqueue('report', 'Central VPS · relatório diário', message, timestamp, config, current.date);
      }
      state.sentAt = state.sentAt.filter(at => numeric(at) && at > timestamp - HOUR && at <= timestamp);
      for (const date of Object.keys(state.days)) if (date < calendar(timestamp - 8 * DAY, config.timeZone).date) delete state.days[date];
      for (const date of Object.keys(state.reports)) if (date < calendar(timestamp - 8 * DAY, config.timeZone).date) delete state.reports[date];
      // Precisamos persistir o UUID antes de tentar a rede; falha de disco impede envio.
      try { await save(); } catch { state = undefined; return { enabled: true, error: 'state_unavailable' }; }
      const pending = state.pending.find(item => item.nextAttemptAt <= timestamp);
      if (!pending || state.sentAt.length >= 8) return { enabled: true, pending: state.pending.length, sent: false };
      pending.attempts++; pending.nextAttemptAt = timestamp + 30 * MINUTE; state.sentAt.push(timestamp);
      try { await save(); } catch { state = undefined; return { enabled: true, error: 'state_unavailable' }; }
      const payload = { source: 'central', event_type: 'infra.vps_status', audience: pending.audience,
        idempotency_key: `central:${pending.type}:${pending.id}`, title: pending.title, message: pending.message };
      let accepted = false, responseStatus = null;
      try {
        const response = await fetchImpl(config.endpoint, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.token}` }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10_000) });
        responseStatus = Number.isInteger(response.status) ? response.status : null;
        accepted = responseStatus === 202;
        await response.body?.cancel?.();
      } catch { /* A tentativa seguinte reutiliza UUID e payload sem imprimir erro/segredo. */ }
      if (accepted) {
        state.pending = state.pending.filter(item => item.id !== pending.id);
        if (pending.type === 'report' && state.reports[pending.date]) state.reports[pending.date].acceptedAt = timestamp;
        try { await save(); } catch { state = undefined; return { enabled: true, error: 'state_unavailable', accepted: true }; }
      }
      return { enabled: true, sent: accepted, pending: state.pending.length, queued: events.length,
        ...(!accepted ? { error: responseStatus === 422 ? 'recipient_unavailable' : 'delivery_unavailable', httpStatus: responseStatus } : {}) };
    } finally { busy = false; }
  }
  return { tick };
}
