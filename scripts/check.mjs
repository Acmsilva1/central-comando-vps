import './sync-pwa-version.mjs';
import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
for(const root of ['src','scripts','public','tests'])for(const file of await readdir(root))if(/\.(mjs|js)$/.test(file)){const result=spawnSync(process.execPath,['--check',`${root}/${file}`],{stdio:'inherit'});if(result.status)process.exit(result.status||1);}
const manifest=JSON.parse(await readFile('public/manifest.webmanifest','utf8'));
for(const icon of manifest.icons){const bytes=await readFile(`public${icon.src}`);if(icon.type==='image/png'&&bytes.readUInt32BE(16)!==Number(icon.sizes.split('x')[0]))throw new Error('Invalid icon dimensions');}
console.log('Sintaxe e manifest PWA: OK');
