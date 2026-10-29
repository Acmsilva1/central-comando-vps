import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMonitor, loadMonitorConfig } from '../src/monitor.mjs';
import { demoSnapshot, normalizeSnapshot } from '../src/metrics.mjs';

const MINUTE=60000;
async function fixture(t, options={}){
  const dir=await mkdtemp(join(tmpdir(),'central-monitor-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  let now=Date.parse(options.date || '2026-10-28T12:00:00Z'), snapshot;
  const configFile=join(dir,'mensageria.json'),stateFile=join(dir,'monitor-state.json');
  const config={endpoint:'https://mensageria.example/api/control?action=event',token:'integration-key-for-isolated-unit-tests-only',audience:'1',project:'central-comando-vps',reportHour:20,timeZone:'America/Sao_Paulo'};
  await writeFile(configFile,JSON.stringify(config));
  const calls=[];
  const fetchImpl=async (url,request)=>{calls.push({url,body:JSON.parse(request.body),request});return options.fetchImpl?options.fetchImpl(url,request):{status:202};};
  const update=(changes={})=>{snapshot=normalizeSnapshot(demoSnapshot(now),now);snapshot.source='host-collector';Object.assign(snapshot.host,changes);return snapshot;};
  update();const store={snapshot:()=>snapshot};
  const create=()=>createMonitor({store,configFile,stateFile,now:()=>now,fetchImpl});let monitor=create();
  return {calls,config,configFile,stateFile,update,create,store,get snapshot(){return snapshot;},set snapshot(v){snapshot=v;},tick:()=>monitor.tick(),restart:()=>{monitor=create();},advance:(duration=MINUTE)=>{now+=duration;update();},get now(){return now;}};
}

test('sem config/HTTPS valido fica desabilitado e nunca envia em demo',async t=>{
  const f=await fixture(t);await writeFile(f.configFile,JSON.stringify({...f.config,endpoint:'http://example.test/api/control?action=event'}));
  assert.equal((await f.tick()).reason,'config_unavailable');assert.equal(f.calls.length,0);
  await writeFile(f.configFile,JSON.stringify(f.config));f.snapshot.source='demo';assert.equal((await f.tick()).reason,'demo');assert.equal(f.calls.length,0);
  await writeFile(f.configFile,JSON.stringify({...f.config,enabled:false}));assert.equal(await loadMonitorConfig(f.configFile),null);
});

test('CPU critica exige dois minutos, nao repete e envia recuperacao abaixo de85%',async t=>{
  const f=await fixture(t);f.update({cpuPercent:95});await f.tick();assert.equal(f.calls.length,0);
  f.advance();f.update({cpuPercent:94});await f.tick();assert.equal(f.calls.length,0);
  f.advance();f.update({cpuPercent:96});await f.tick();assert.equal(f.calls.length,1);assert.match(f.calls[0].body.message,/ALERTA: CPU/);
  f.advance();f.update({cpuPercent:98});await f.tick();assert.equal(f.calls.length,1);
  f.advance();f.update({cpuPercent:88});await f.tick();assert.equal(f.calls.length,1);
  f.advance();f.update({cpuPercent:40});await f.tick();assert.equal(f.calls.length,2);assert.match(f.calls[1].body.message,/RECUPERADO: CPU/);
  assert.equal(f.calls[0].body.source,'central');assert.equal(f.calls[0].body.event_type,'infra.vps_status');assert.equal(f.calls[0].body.audience,'1');assert.equal('agent_request'in f.calls[0].body,false);assert.equal('agent_project'in f.calls[0].body,false);
  assert.match(f.calls[0].body.message,/^📊 Central de Comando\n/);
});

test('RAM e disco criticos sao agrupados e lacuna nao conta como uso sustentado',async t=>{
  const f=await fixture(t);f.update({memoryPercent:94,diskPercent:93});await f.tick();
  f.advance();f.snapshot.stale=true;await f.tick();f.advance();f.update({memoryPercent:94,diskPercent:93});await f.tick();assert.equal(f.calls.length,0);
  f.advance();f.update({memoryPercent:94,diskPercent:93});await f.tick();assert.equal(f.calls.length,0);
  f.advance();f.update({memoryPercent:94,diskPercent:93});await f.tick();assert.equal(f.calls.length,1);assert.match(f.calls[0].body.message,/RAM/);assert.match(f.calls[0].body.message,/Disco/);
});
test('pausa prolongada do agendador nao confirma uso alto sustentado',async t=>{
  const f=await fixture(t);f.update({cpuPercent:96});await f.tick();
  f.advance(10*MINUTE);f.restart();f.update({cpuPercent:96});await f.tick();assert.equal(f.calls.length,0);
  f.advance();f.update({cpuPercent:96});await f.tick();assert.equal(f.calls.length,0);
  f.advance();f.update({cpuPercent:96});await f.tick();assert.equal(f.calls.length,1);
});

test('parada, saude, OOM, reinicio e container ausente geram mudanca e recuperacao',async t=>{
  const f=await fixture(t);await f.tick();
  f.advance();f.snapshot.containers[0].state='exited';f.snapshot.containers[0].oomKilled=true;await f.tick();assert.equal(f.calls.length,1);assert.match(f.calls[0].body.message,/falta de memória/);
  f.advance();f.snapshot.containers[0].health='unhealthy';f.snapshot.containers[1].restarts=1;await f.tick();assert.equal(f.calls.length,2);assert.match(f.calls[1].body.message,/reinícios aumentaram/);
  f.advance();await f.tick();assert.equal(f.calls.length,3);assert.match(f.calls[2].body.message,/RECUPERADO/);
  f.advance();f.snapshot.containers.pop();await f.tick();assert.equal(f.calls.length,4);assert.match(f.calls[3].body.message,/não aparece/);
  f.advance();await f.tick();assert.equal(f.calls.length,5);assert.match(f.calls[4].body.message,/voltou à lista/);
});

test('coletor sem leitura alerta apenas uma vez e reconhece recuperacao',async t=>{
  const f=await fixture(t);await f.tick();f.advance(61000);f.snapshot=null;await f.tick();assert.equal(f.calls.length,1);assert.match(f.calls[0].body.message,/Coletor sem leitura/);
  f.advance();f.snapshot=null;await f.tick();assert.equal(f.calls.length,1);
  f.advance();await f.tick();assert.equal(f.calls.length,2);assert.match(f.calls[1].body.message,/voltou a atualizar/);
});

test('retry30min preserva UUID e payload apos reinicio e nao guarda token de integracao',async t=>{
  let accepted=false;const f=await fixture(t,{fetchImpl:async()=>({status:accepted?202:422})});
  f.snapshot.containers[0].state='paused';const first=await f.tick();assert.equal(first.error,'recipient_unavailable');assert.equal(first.httpStatus,422);
  const body=f.calls[0].body,serialized=await readFile(f.stateFile,'utf8');assert.equal(serialized.includes(f.config.token),false);assert.equal(JSON.parse(serialized).pending.length,1);
  f.restart();f.advance();f.snapshot.containers[0].state='paused';await f.tick();assert.equal(f.calls.length,1);
  accepted=true;f.advance(30*MINUTE);f.snapshot.containers[0].state='paused';await writeFile(f.configFile,JSON.stringify({...f.config,project:'changed-project'}));await f.tick();
  assert.equal(f.calls.length,2);assert.deepEqual(f.calls[1].body,body);assert.equal(JSON.parse(await readFile(f.stateFile,'utf8')).pending.length,0);
});

test('relatorio diario usa20h SaoPaulo, persiste deduplicacao e conta so amostras observadas',async t=>{
  const f=await fixture(t,{date:'2026-10-28T22:59:00Z'});await f.tick();assert.equal(f.calls.length,0);
  f.advance();await f.tick();assert.equal(f.calls.length,1);assert.match(f.calls[0].body.title,/relatório diário/);assert.match(f.calls[0].body.message,/2026-10-28/);assert.match(f.calls[0].body.message,/2 amostras/);assert.match(f.calls[0].body.message,/não equivalem a disponibilidade/);
  f.restart();f.advance();await f.tick();assert.equal(f.calls.length,1);
  f.advance(24*60*MINUTE);await f.tick();assert.equal(f.calls.length,2);assert.notEqual(f.calls[1].body.idempotency_key,f.calls[0].body.idempotency_key);
});

test('estado corrompido falha fechado sem duplicar notificacoes',async t=>{
  const f=await fixture(t);await writeFile(f.stateFile,'{broken');f.snapshot.containers[0].state='exited';const result=await f.tick();assert.equal(result.error,'state_unavailable');assert.equal(f.calls.length,0);
});

test('limita8 tentativas por hora e mantem fila para evitar tempestade',async t=>{
  const f=await fixture(t);await f.tick();
  for(let i=0;i<10;i++){f.advance();f.snapshot.containers[0].state=i%2===0?'paused':'running';await f.tick();}
  assert.equal(f.calls.length,8);assert.equal(JSON.parse(await readFile(f.stateFile,'utf8')).pending.length,2);
});
