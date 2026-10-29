import { readFileSync, statSync } from 'node:fs';
import { mkdir, chmod, open, link, unlink, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { hashToken, validHash } from './auth.mjs';

export function validateCredentials(value) {
  if (!value || Object.keys(value).length !== 2 || value.version !== 1 || !validHash(value.tokenHash)) throw new Error('Arquivo de credencial invalido. Execute npm run admin:create para configurar a chave de administracao.');
  return { version: 1, tokenHash: value.tokenHash };
}
export function loadCredentials(file) {
  try {
    if (statSync(file).size > 4096) throw new Error('credential_file_too_large');
    const content = readFileSync(file, 'utf8');
    if (Buffer.byteLength(content) > 4096) throw new Error('credential_file_too_large');
    return validateCredentials(JSON.parse(content));
  } catch {
    throw new Error('Credencial ausente ou invalida. Execute npm run admin:create no mesmo AUTH_FILE/volume antes de iniciar a central.');
  }
}
export async function createCredentialFile({ file, token, reset = false }) {
  if (typeof token !== 'string' || token.length < 32 || token.length > 256) throw new Error('A chave de administracao precisa ter de 32 a 256 caracteres.');
  const target = resolve(file), folder = dirname(target);
  await mkdir(folder, { recursive: true, mode: 0o700 });
  await chmod(folder, 0o700);
  const credentials = { version: 1, tokenHash: await hashToken(token) };
  const temporary = resolve(folder, `.admin-${randomBytes(12).toString('hex')}.tmp`);
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(credentials)}\n`, 'utf8');
    await handle.sync();
    await handle.close(); handle = null;
    if (reset) await rename(temporary, target);
    else await link(temporary, target);
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('A chave de administracao ja existe. Use --reset explicitamente para redefinir a credencial.');
    throw error;
  } finally {
    await handle?.close();
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
  return { created: true };
}
