import { randomBytes, createHash, scrypt as derive, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PoolClient } from 'pg';
import { database, transaction } from './database.ts';
export interface AuthUser { id: string; email: string }
export interface AuthBody { email?: unknown; password?: unknown; fullName?: unknown; workspaceName?: unknown }
const options = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
let activeDerivations = 0;
async function derivePassword(password: string, salt: string): Promise<Buffer> {
  if (activeDerivations >= 2) throw fail(429, 'Servidor ocupado. Intenta de nuevo en unos segundos.');
  activeDerivations++;
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      derive(password, salt, 64, options, (error, key) => error ? reject(error) : resolve(key));
    });
  }
  finally { activeDerivations--; }
}
export const fail = (status: number, message: string) => Object.assign(new Error(message), { status });
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export async function hashPassword(password: unknown) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) throw fail(400, 'Usa una contraseña de 12 a 256 caracteres.');
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${(await derivePassword(password, salt)).toString('hex')}`;
}
export async function matchesPassword(password: string, encoded?: string) {
  const [salt, expected] = (encoded || `${'0'.repeat(32)}:${'0'.repeat(128)}`).split(':');
  const actual = await derivePassword(password, salt);
  return timingSafeEqual(actual, Buffer.from(expected, 'hex'));
}
export function sessionToken(req: IncomingMessage) {
  return (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('she_session='))?.slice(12) || '';
}
export function cookie(res: ServerResponse, token: string, maxAge = 604800) {
  res.setHeader('Set-Cookie', `she_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''}`);
}
export async function currentUser(req: IncomingMessage): Promise<AuthUser | null> {
  const token = sessionToken(req);
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const { rows } = await database().query<AuthUser>(`select u.id,u.email from auth.sessions s join auth.users u on u.id=s.user_id
    where token_hash=$1 and expires_at>now()`, [hashToken(token)]);
  return rows[0] || null;
}
export async function createSession(client: PoolClient, userId: string) {
  const token = randomBytes(32).toString('hex');
  await client.query('delete from auth.sessions where expires_at<=now()');
  await client.query("insert into auth.sessions(token_hash,user_id,expires_at) values($1,$2,now()+interval '7 days')", [hashToken(token), userId]);
  return token;
}
export async function authenticate(req: IncomingMessage, body: AuthBody, signup: boolean) {
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || typeof body.password !== 'string' || body.password.length > 256) throw fail(400, 'Correo o contraseña inválidos.');
  const password = body.password;
  // Database-backed limit shared by all Node processes; do not trust proxy headers.
  const key = hashToken(req.socket.remoteAddress || 'local');
  const limit = await database().query(`insert into auth.login_limits(key,attempts,reset_at) values($1,1,now()+interval '15 minutes')
    on conflict(key) do update set attempts=case when auth.login_limits.reset_at<now() then 1 else auth.login_limits.attempts+1 end,
    reset_at=case when auth.login_limits.reset_at<now() then now()+interval '15 minutes' else auth.login_limits.reset_at end returning attempts`, [key]);
  if (limit.rows[0].attempts > 30) throw fail(429, 'Demasiados intentos. Intenta de nuevo en 15 minutos.');
  if (signup) {
    if (typeof body.fullName !== 'string' || body.fullName.trim().length < 2 || body.fullName.length > 120 || typeof body.workspaceName !== 'string' || body.workspaceName.trim().length < 2 || body.workspaceName.length > 120) throw fail(400, 'Indica nombre y espacio de trabajo (2 a 120 caracteres).');
    const passwordHash = await hashPassword(password);
    const fullName = body.fullName.trim(), workspaceName = body.workspaceName.trim();
    return transaction(async client => {
      await client.query("select pg_advisory_xact_lock(90121012)");
      if (process.env.ALLOW_REGISTRATION !== 'true' && (await client.query('select 1 from auth.users limit 1')).rowCount) throw fail(403, 'El registro está cerrado. Solicita acceso a Dirección.');
      const { rows: [user] } = await client.query<AuthUser>(`insert into auth.users(email,password_hash,raw_user_meta_data) values($1,$2,$3) returning id,email`,
        [email, passwordHash, JSON.stringify({ full_name: fullName, workspace_name: workspaceName })]);
      return { user, token: await createSession(client, user.id) };
    });
  }
  const { rows: [user] } = await database().query<AuthUser & { password_hash: string }>('select id,email,password_hash from auth.users where email=$1', [email]);
  if (!await matchesPassword(password, user?.password_hash) || !user) throw fail(401, 'Correo o contraseña incorrectos.');
  return transaction(async client => ({ user: { id: user.id, email: user.email }, token: await createSession(client, user.id) }));
}
