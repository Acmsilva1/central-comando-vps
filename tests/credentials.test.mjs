import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCredentials, createCredentialFile } from '../src/credentials.mjs';
import { verifyToken } from '../src/auth.mjs';
import { createApp } from '../src/server.mjs';
const cli=fileURLToPath(new URL('../scripts/admin-create.mjs',import.meta.url));
const token='local-test-administration-key-for-volume';
const newToken='another-long-test-administration-key-for-volume';
test('CLI persiste hash da chave sem exibir segredo, recusa sobrescrita e permite reset explicito',async t=>{
  const folder=await mkdtemp(join(tmpdir(),'central-auth-'));t.after(()=>rm(folder,{recursive:true,force:true}));
  const file=join(folder,'auth','admin.json'),env={...process.env,AUTH_FILE:file};
  const first=spawnSync(process.execPath,[cli],{env,input:`${token}\n`,encoding:'utf8'});
  assert.equal(first.status,0,first.stderr);assert.doesNotMatch(first.stdout,new RegExp(token));assert.doesNotMatch(first.stdout,/scrypt:/);
  const raw=await readFile(file,'utf8'),credential=loadCredentials(file);
  assert.deepEqual(Object.keys(credential).sort(),['tokenHash','version']);assert.equal(await verifyToken(token,credential.tokenHash),true);assert.equal(raw.includes(token),false);assert.equal('token'in JSON.parse(raw),false);
  if(process.platform!=='win32'){assert.equal((await stat(file)).mode&0o777,0o600);assert.equal((await stat(join(folder,'auth'))).mode&0o777,0o700);}
  const duplicate=spawnSync(process.execPath,[cli],{env,input:`${newToken}\n`,encoding:'utf8'});
  assert.equal(duplicate.status,1);assert.match(duplicate.stderr,/--reset/);assert.equal(await readFile(file,'utf8'),raw);
  const reset=spawnSync(process.execPath,[cli,'--reset'],{env,input:`${newToken}\n`,encoding:'utf8'});
  assert.equal(reset.status,0,reset.stderr);assert.equal(await verifyToken(newToken,loadCredentials(file).tokenHash),true);assert.equal(await verifyToken(token,loadCredentials(file).tokenHash),false);
  await writeFile(file,JSON.stringify({...loadCredentials(file),token:'plaintext'}));assert.throws(()=>loadCredentials(file),/admin:create/);
  const legacy=spawnSync(process.execPath,[cli,'--username','admin'],{env,input:`${token}\n`,encoding:'utf8'});assert.equal(legacy.status,1);assert.match(legacy.stderr,/Uso:/);
});
test('arquivo ausente, grande, formato de usuario antigo ou chave literal falha fechado',async t=>{
  const folder=await mkdtemp(join(tmpdir(),'central-auth-invalid-'));t.after(()=>rm(folder,{recursive:true,force:true}));const file=join(folder,'admin.json');
  assert.throws(()=>loadCredentials(file),/admin:create/);
  for(const content of ['x'.repeat(5000),'{"version":1,"username":"admin","passwordHash":"old"}','{"version":1,"token":"plaintext"}','null','{invalid']){await writeFile(file,content);assert.throws(()=>loadCredentials(file),/admin:create/);}
});
test('login le a credencial persistente e continua funcionando apos recriar servidor',async t=>{
  const folder=await mkdtemp(join(tmpdir(),'central-auth-login-'));t.after(()=>rm(folder,{recursive:true,force:true}));const file=join(folder,'auth','admin.json');
  await createCredentialFile({file,token});
  const metrics={collect:async()=>{},snapshot:()=>({containers:[],host:{}}),history:()=>[]};
  let oldToken;
  for(let run=0;run<2;run++){
    const {server}=createApp({env:{PORT:'0',APP_ORIGIN:'https://central.test',AUTH_FILE:file},metrics});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
    try{
      if(oldToken)assert.equal((await fetch(base+'/api/overview',{headers:{Cookie:oldToken}})).status,401);
      const response=await fetch(base+'/api/login',{method:'POST',headers:{Origin:'https://central.test','Content-Type':'application/json','X-Panel-Request':'1'},body:JSON.stringify({token})});
      assert.equal(response.status,200);oldToken=response.headers.get('set-cookie').split(';')[0];
      assert.equal((await fetch(base+'/api/overview',{headers:{Cookie:oldToken}})).status,200);
      const logout=await fetch(base+'/api/logout',{method:'POST',headers:{Origin:'https://central.test','Content-Type':'application/json','X-Panel-Request':'1',Cookie:oldToken},body:'{}'});assert.equal(logout.status,200);
      assert.equal((await fetch(base+'/api/overview',{headers:{Cookie:oldToken}})).status,401);
    }finally{await new Promise(resolve=>server.close(resolve));}
  }
});
