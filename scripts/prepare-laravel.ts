import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { loadEnv } from 'vite';
import pg from 'pg';

// Reuse the existing local PostgreSQL server, with a separate database. Never rotate
// a shared role's password or overwrite the original installation's configuration.
const own = Object.fromEntries(Object.entries(loadEnv('development', '.', '')).filter(([, value]) => value !== ''));
const source = { ...loadEnv('development', '..', ''), ...own, ...process.env };
if (!source.DATABASE_ADMIN_URL || !source.DATABASE_URL) throw new Error('Arranca PostgreSQL local y configura sus URL administrativas.');
const adminUrl = new URL(source.DATABASE_ADMIN_URL), appUrl = new URL(source.DATABASE_URL);
adminUrl.pathname = '/she_crm_laravel'; appUrl.pathname = '/she_crm_laravel';
const client = new pg.Client({ connectionString: source.DATABASE_ADMIN_URL });
await client.connect();
try {
  if (!(await client.query('select 1 from pg_database where datname=$1', ['she_crm_laravel'])).rowCount) await client.query('create database she_crm_laravel');
} finally { await client.end(); }
await mkdir('.local', { recursive: true });
if (!existsSync('backend/.env')) {
  const configuration = [
    'APP_NAME="SHE CRM"', 'APP_ENV=local', `APP_KEY=base64:${randomBytes(32).toString('base64')}`,
    'APP_DEBUG=false', 'APP_URL=http://127.0.0.1:8000', 'APP_ORIGIN=http://127.0.0.1:5173',
    'LOG_CHANNEL=single', 'SESSION_DRIVER=file', 'CACHE_STORE=file', 'QUEUE_CONNECTION=sync',
    `DATABASE_URL="${appUrl.href}"`, `DATABASE_ADMIN_URL="${adminUrl.href}"`,
    'ALLOW_REGISTRATION=false', 'COOKIE_SECURE=false', 'CRM_LOGIN_USER=direccion',
    'CRM_OWNER_EMAIL=direccion@hotelexpert.mx',
  ];
  await writeFile('backend/.env', configuration.join('\n') + '\n', { flag: 'wx', mode: 0o600 });
}
if (!existsSync('.env.local')) await writeFile('.env.local', `VITE_BACKEND=local\nVITE_API_BACKEND=laravel\nLARAVEL_API_URL=http://127.0.0.1:8000\nDATABASE_URL="${appUrl.href}"\nDATABASE_ADMIN_URL="${adminUrl.href}"\n`, { flag: 'wx', mode: 0o600 });
const result = spawnSync('php', ['artisan', 'she:migrate'], { cwd: 'backend', stdio: 'inherit', windowsHide: true });
process.exitCode = result.status ?? 1;
if (result.error) throw result.error;
