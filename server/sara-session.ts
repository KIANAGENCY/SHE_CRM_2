import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fail, matchesPassword } from './auth.ts';
import { sameSecret } from './webhook-utils.ts';

const cookieName = 'she_sara_session';
const lifetime = 7 * 24 * 60 * 60 * 1000;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const requiresSaraLogin = () => Boolean(process.env.SARA_PUBLIC_ORIGIN || process.env.CRM_LOGIN_PASSWORD_HASH);
export function saraCookie(response: ServerResponse, token: string, maxAge = lifetime / 1000) {
  response.setHeader('Set-Cookie', `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${process.env.SARA_PUBLIC_ORIGIN || process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''}`);
}
export function saraToken(request: IncomingMessage): string {
  return (request.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) || '';
}
export function saraContext(username: string) {
  return { user: { id: 'sara-owner', email: username }, workspace: { id: 'sara-local', name: 'Hotel Expert' }, role: 'owner', roleLabel: 'Dirección' };
}

export function openSaraSessions(path = resolve('.local/sara-auth.sqlite')) {
  const username = process.env.CRM_LOGIN_USER || 'direccion';
  const encodedPassword = process.env.CRM_LOGIN_PASSWORD_HASH;
  if (!encodedPassword || !/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(encodedPassword)) throw fail(503, 'Configura la cuenta de acceso del CRM.');
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,username TEXT NOT NULL,expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS login_limits(key TEXT PRIMARY KEY,attempts INTEGER NOT NULL,reset_at INTEGER NOT NULL);`);

  async function login(user: unknown, password: unknown, address: string) {
    if (typeof user !== 'string' || user.length > 254 || typeof password !== 'string' || password.length > 256 || !password) throw fail(400, 'Indica tu usuario y contraseña.');
    const now = Date.now();
    const limit = db.prepare(`INSERT INTO login_limits(key,attempts,reset_at) VALUES(?,1,?)
      ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN reset_at<=? THEN 1 ELSE attempts+1 END,
      reset_at=CASE WHEN reset_at<=? THEN excluded.reset_at ELSE reset_at END RETURNING attempts`)
      .get(hash(address), now + 15 * 60 * 1000, now, now);
    if (Number(limit.attempts) > 30) throw fail(429, 'Demasiados intentos. Intenta de nuevo en 15 minutos.');
    const validPassword = await matchesPassword(password, encodedPassword);
    if (!sameSecret(user.trim().toLowerCase(), username.toLowerCase()) || !validPassword) throw fail(401, 'Usuario o contraseña incorrectos.');
    db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(now);
    const token = randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions(token_hash,username,expires_at) VALUES(?,?,?)').run(hash(token), username, now + lifetime);
    return { token, context: saraContext(username) };
  }
  function current(token: string) {
    if (!/^[a-f0-9]{64}$/.test(token)) return null;
    const row = db.prepare('SELECT username FROM sessions WHERE token_hash=? AND expires_at>?').get(hash(token), Date.now());
    return row?.username === username ? saraContext(username) : null;
  }
  function logout(token: string) {
    if (/^[a-f0-9]{64}$/.test(token)) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(token));
  }
  return { login, current, logout, close: () => db.close() };
}
