import { randomBytes, scrypt as derive, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(derive);
export async function hashToken(token) {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(token, salt, 64);
  return `scrypt:${salt}:${key.toString('hex')}`;
}
export function validHash(hash = '') { return /^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(hash); }
export async function verifyToken(token, hash) {
  if (!validHash(hash) || typeof token !== 'string' || token.length < 32 || token.length > 256) return false;
  const [, salt, expected] = hash.split(':');
  const key = await scrypt(token, salt, 64);
  return timingSafeEqual(key, Buffer.from(expected, 'hex'));
}
export function createAuth({ tokenHash, now = Date.now }) {
  const sessions = new Map(), attempts = new Map();
  let deriving = 0;
  function sweep() {
    for (const [key, value] of attempts) if (value.until <= now()) attempts.delete(key);
    for (const [key, value] of sessions) if (value <= now()) sessions.delete(key);
  }
  return {
    async login(ip, token) {
      sweep();
      const attempt = attempts.get(ip) || { count: 0, until: now() + 15 * 60_000 };
      if (attempt.count >= 5 || attempts.size >= 1000 || sessions.size >= 100 || deriving >= 2) return { status: 429 };
      attempt.count++; attempts.set(ip, attempt);
      let correct;
      deriving++;
      try { correct = await verifyToken(token, tokenHash); }
      finally { deriving--; }
      if (!correct) return { status: 401 };
      if (sessions.size >= 100) return { status: 429 };
      attempts.delete(ip);
      const sessionToken = randomBytes(32).toString('hex');
      sessions.set(sessionToken, now() + 8 * 60 * 60_000);
      return { status: 200, token:sessionToken };
    },
    valid(token) { sweep(); return typeof token === 'string' && sessions.has(token); },
    revoke(token) { sessions.delete(token); }
  };
}
