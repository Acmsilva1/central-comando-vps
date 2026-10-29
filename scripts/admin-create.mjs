import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { createCredentialFile } from '../src/credentials.mjs';

function readHiddenToken() {
  if (!process.stdin.isTTY) return (async () => {
    const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
    try { for await (const line of input) return line; return ''; }
    finally { input.close(); }
  })();
  process.stdout.write('Chave de administracao (32 a 256 caracteres; entrada oculta): ');
  return new Promise((resolveToken, reject) => {
    let token = '';
    process.stdin.setEncoding('utf8');
    process.stdin.setRawMode(true);
    process.stdin.resume();
    function cleanup() { process.stdin.off('data', onData); process.stdin.off('end', onEnd); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n'); }
    function onEnd() { cleanup(); reject(new Error('Entrada interrompida.')); }
    function onData(chunk) {
      for (const char of chunk) {
        if (char === '\u0003') { cleanup(); reject(new Error('Operacao cancelada.')); return; }
        if (char === '\r' || char === '\n') { cleanup(); resolveToken(token); return; }
        if (char === '\u007f' || char === '\b') token = Array.from(token).slice(0, -1).join('');
        else if (char.codePointAt(0) >= 32) token += char;
        if (token.length > 256) { cleanup(); reject(new Error('A chave excedeu 256 caracteres.')); return; }
      }
    }
    process.stdin.on('data', onData); process.stdin.once('end', onEnd);
  });
}

try {
  let reset = false;
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--reset') reset = true;
    else throw new Error('Uso: npm run admin:create -- [--reset]. Informe a chave apenas pela entrada oculta/stdin.');
  }
  const token = await readHiddenToken();
  await createCredentialFile({ file: resolve(process.env.AUTH_FILE || '.runtime/auth/admin.json'), token, reset });
  console.log('Chave de administracao salva no volume de autenticacao. A chave e o hash nao sao exibidos.');
} catch (error) {
  // Mensagens de erro nunca incluem a chave ou o conteudo da credencial.
  console.error(error.code ? 'Nao foi possivel gravar a credencial. Verifique permissoes e AUTH_FILE.' : error.message);
  process.exitCode = 1;
}
