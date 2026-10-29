import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeSnapshot, demoSnapshot, createMetrics } from '../src/metrics.mjs';
test('RAM usa MemAvailable, limita percentuais e descarta campos sensiveis',()=>{
  const raw=demoSnapshot();raw.host.cpuPercent=999;raw.host.secret='not-public';raw.containers[0].environment={PASSWORD:'not-public'};
  const value=normalizeSnapshot(raw);assert.equal(value.host.cpuPercent,100);assert.equal(value.host.memoryUsed,raw.host.memoryTotal-raw.host.memoryAvailable);
  assert.equal('secret'in value.host,false);assert.equal('environment'in value.containers[0],false);assert.equal(value.containers[0].memoryLimit,null);
});
test('leitura antiga e timestamp invalido nao parecem atuais',()=>{
  const raw=demoSnapshot(1000);assert.equal(normalizeSnapshot(raw,100000).stale,true);
  raw.sampledAt='invalid';assert.throws(()=>normalizeSnapshot(raw));
  raw.sampledAt=new Date(999999).toISOString();assert.throws(()=>normalizeSnapshot(raw,1000));
});
test('snapshot incompleto nao vira metrica zero e valores nao excedem capacidade',()=>{
  const raw=demoSnapshot();delete raw.host.memoryAvailable;assert.throws(()=>normalizeSnapshot(raw));
  const invalid=demoSnapshot();invalid.containers.push(null);assert.throws(()=>normalizeSnapshot(invalid));
  const overflow=demoSnapshot();overflow.host.memoryAvailable=overflow.host.memoryTotal*2;overflow.host.diskUsed=overflow.host.diskTotal*2;
  const normalized=normalizeSnapshot(overflow);assert.equal(normalized.host.memoryAvailable,normalized.host.memoryTotal);assert.equal(normalized.host.memoryUsed,0);assert.equal(normalized.host.diskPercent,100);
});
test('coletor ausente nao fabrica dados',async()=>{
  const store=createMetrics({file:'nonexistent/metrics.json'});await store.collect();assert.equal(store.snapshot(),null);assert.deepEqual(store.history(),[]);
});
test('historico persiste, evita duplicatas e preserva ultima leitura como antiga se falhar',async t=>{
  const folder=await mkdtemp(join(tmpdir(),'central-metrics-'));t.after(()=>rm(folder,{recursive:true,force:true}));
  let now=Date.now();const file=join(folder,'snapshot.json'),historyFile=join(folder,'history.json');
  await writeFile(file,JSON.stringify(demoSnapshot(now)));const store=createMetrics({file,historyFile,now:()=>now});
  await store.collect();await store.collect();assert.equal(store.history().length,1);
  now+=60_001;await writeFile(file,JSON.stringify(demoSnapshot(now)));await store.collect();assert.equal(store.history().length,2);
  assert.equal(JSON.parse(await readFile(historyFile,'utf8')).length,2);
  await writeFile(file,'broken');await store.collect();assert.equal(store.snapshot().stale,true);
  const restarted=createMetrics({file,historyFile,now:()=>now});await restarted.collect();assert.equal(restarted.history().length,2);
});
test('service worker nao coloca APIs, HTML autenticado ou sessoes no cache',async()=>{
  const sw=await readFile(new URL('../public/sw.js',import.meta.url),'utf8');assert.match(sw,/url.pathname.startsWith\('\/api\/'\)/);
  assert.match(sw,/const ASSETS = \['\/offline.html'/);assert.doesNotMatch(sw,/cache\.put/);assert.doesNotMatch(sw,/ASSETS = .*['"]\/['"]/);
});
test('historico restaurado valida campos e nao devolve propriedades extras',async t=>{
  const folder=await mkdtemp(join(tmpdir(),'central-history-'));t.after(()=>rm(folder,{recursive:true,force:true}));
  const now=Date.now(),file=join(folder,'snapshot.json'),historyFile=join(folder,'history.json');
  await writeFile(file,JSON.stringify(demoSnapshot(now)));
  await writeFile(historyFile,JSON.stringify([
    null,{at:now-10000,cpu:1,memory:2,disk:3,secret:'not-public',containers:[{name:'a',cpu:2,memory:3,secret:'not-public'}]},
    {at:now+10000,cpu:1,memory:2,disk:3},{at:now-5000,cpu:'bad',memory:2,disk:3}
  ]));
  const store=createMetrics({file,historyFile,now:()=>now});await store.collect();const restored=store.history();
  assert.equal(restored.length,1);assert.equal('secret'in restored[0],false);assert.equal('secret'in restored[0].containers[0],false);
  restored[0].containers[0].name='changed';assert.equal(store.history()[0].containers[0].name,'a');
});
test('falha ao salvar historico nao torna uma coleta atual desatualizada',async t=>{
  const folder=await mkdtemp(join(tmpdir(),'central-history-failure-'));t.after(()=>rm(folder,{recursive:true,force:true}));
  const file=join(folder,'snapshot.json'),blocking=join(folder,'not-a-directory');
  await writeFile(file,JSON.stringify(demoSnapshot()));await writeFile(blocking,'file');
  const store=createMetrics({file,historyFile:join(blocking,'history.json')});await store.collect();
  assert.equal(store.snapshot().stale,false);assert.equal(store.snapshot().historyAvailable,false);assert.equal(store.history().length,1);
});
