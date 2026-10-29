import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createAuth } from './auth.mjs';
import { loadCredentials, validateCredentials } from './credentials.mjs';
import { createMetrics } from './metrics.mjs';
import { createMonitor } from './monitor.mjs';
const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
export function createApp({ env = process.env, demo = false, metrics, credentials } = {}) {
  const port = Number(env.PORT || 8081), host = demo ? '127.0.0.1' : env.HOST || '127.0.0.1';
  const origin = new URL(demo ? `http://127.0.0.1:${port}` : env.APP_ORIGIN || 'http://127.0.0.1:8081');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT invalida.');
  if (!demo && (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash)) throw new Error('Configure APP_ORIGIN com a origem HTTPS da central.');
  const administrator = demo ? null : credentials ? validateCredentials(credentials) : loadCredentials(resolve(env.AUTH_FILE || '.runtime/auth/admin.json'));
  const auth = createAuth({ tokenHash: administrator?.tokenHash });
  const store = metrics || createMetrics({ file: resolve(env.METRICS_FILE || '.runtime/metrics/snapshot.json'), historyFile: resolve(env.HISTORY_FILE || '.runtime/history.json'), demo });
  const monitor = !demo && env.MONITOR_CONFIG_FILE ? createMonitor({store,configFile:env.MONITOR_CONFIG_FILE,stateFile:resolve(env.MONITOR_STATE_FILE||'.runtime/monitor-state.json')}) : null;
  let monitorStatus={enabled:false,reason:demo?'demo':'not_configured'}, monitorError=null;
  async function runMonitor(){
    if(!monitor)return;
    try{monitorStatus=await monitor.tick();}catch{monitorStatus={enabled:true,error:'monitor_unavailable'};}
    const error=monitorStatus.error||(!monitorStatus.enabled?monitorStatus.reason:null);
    if(error&&error!==monitorError)console.error(`Monitor indisponivel: ${error}`);
    monitorError=error;
  }
  const secure = origin.protocol === 'https:';
  const cookie = (value, maxAge) => `central_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
  const routes = new Map([
    ['/ui.js',['ui.js','text/javascript']], ['/ui.css',['ui.css','text/css']], ['/visual.css',['visual.css','text/css']],
    ['/', ['index.html','text/html']], ['/app.js',['app.js','text/javascript']], ['/styles.css',['styles.css','text/css']],
    ['/pwa.js',['pwa.js','text/javascript']], ['/sw.js',['sw.js','text/javascript']], ['/manifest.webmanifest',['manifest.webmanifest','application/manifest+json']],
    ['/offline.html',['offline.html','text/html']], ['/pwa-offline.css',['pwa-offline.css','text/css']], ['/icons/icon.svg',['icons/icon.svg','image/svg+xml']],
    ...[180,192,512].map(n => [`/icons/icon-${n}.png`,[`icons/icon-${n}.png`,'image/png']])
  ]);
  const server = http.createServer({ requestTimeout: 10000, headersTimeout: 10000, maxHeaderSize: 8192 }, async (req,res) => {
    res.setHeader('Cache-Control','no-store'); res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer'); res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    if (secure) res.setHeader('Strict-Transport-Security','max-age=31536000');
    const send = (status, data) => { res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    try {
      const localHost = `127.0.0.1:${server.address()?.port}`;
      if (req.headers.host !== origin.host && req.headers.host !== localHost) return send(403,{error:'origin_rejected'});
      const url = new URL(req.url, origin), path = url.pathname;
      if (path === '/api/health' && req.method === 'GET') return send(200,{ok:true});
      const token = /(?:^|;\s*)central_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
      if (path === '/api/session' && req.method === 'GET') return send(200,{authenticated: demo || auth.valid(token), demo});
      if (req.method === 'POST') {
        if (req.headers.origin !== origin.origin || req.headers['x-panel-request'] !== '1') return send(403,{error:'origin_rejected'});
        if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') return send(415,{error:'json_required'});
      }
      if (path === '/api/login' && req.method === 'POST') {
        if (demo) return send(400,{error:'demo_mode'});
        if (Number(req.headers['content-length'] || 0) > 2048) { res.setHeader('Connection','close'); req.resume(); return send(413,{error:'body_too_large'}); }
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 2048) { res.setHeader('Connection','close'); return send(413,{error:'body_too_large'}); } chunks.push(chunk); }
        let data; try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(400,{error:'invalid_json'}); }
        if (!data || Array.isArray(data) || typeof data !== 'object' || Object.keys(data).length !== 1 || typeof data.token !== 'string') return send(400,{error:'invalid_credentials_payload'});
        const result = await auth.login(req.socket.remoteAddress, data.token);
        if (result.token) res.setHeader('Set-Cookie',cookie(result.token,28800));
        return send(result.status,result.token ? {ok:true} : {error: result.status === 429 ? 'rate_limited' : 'invalid_credentials'});
      }
      if (path === '/api/logout' && req.method === 'POST') { auth.revoke(token); res.setHeader('Set-Cookie',cookie('',0)); return send(200,{ok:true}); }
      if (path.startsWith('/api/')) {
        if (!demo && !auth.valid(token)) return send(401,{error:'authentication_required'});
        if (req.method !== 'GET') return send(405,{error:'read_only'});
        if (path === '/api/overview') {
          const snapshot = store.snapshot();
          return snapshot ? send(200,{...snapshot,demo,monitor:monitorStatus}) : send(503,{error:'collector_unavailable'});
        }
        if (path === '/api/history') return send(200,{points:store.history(url.searchParams.get('period')),demo});
        if (path === '/api/monitor') return send(200,monitorStatus);
        return send(404,{error:'not_found'});
      }
      const route = routes.get(path);
      if (!route || !['GET','HEAD'].includes(req.method)) return send(404,{error:'not_found'});
      const body = await readFile(resolve(publicDir,route[0]));
      if (path === '/sw.js') res.setHeader('Service-Worker-Allowed','/');
      res.writeHead(200,{'Content-Type':`${route[1]}${route[1].startsWith('image/') ? '' : '; charset=utf-8'}`});
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch { if (!res.headersSent) send(500,{error:'internal_error'}); else res.end(); }
  });
  server.maxConnections = 100;
  const timer = setInterval(() => store.collect(),15000); timer.unref();
  const monitorTimer=monitor?setInterval(runMonitor,60000):null;monitorTimer?.unref();
  server.on('close',() => {clearInterval(timer);if(monitorTimer)clearInterval(monitorTimer);});
  return { server, store, host, port, runMonitor };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createApp({demo:process.argv.includes('--demo')});
  await app.store.collect();
  await app.runMonitor();
  app.server.listen(app.port,app.host,() => console.log(`Central de Comando ${process.argv.includes('--demo') ? 'DEMONSTRAÇÃO' : 'privada'}: http://${app.host}:${app.port}`));
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal,() => app.server.close(() => process.exit(0)));
}
