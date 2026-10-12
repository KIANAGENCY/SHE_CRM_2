import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { loadEnv } from 'vite';

const action = process.argv[2] || 'start';
if (!['start','stop','status'].includes(action)) throw new Error('Usa start, stop o status.');
const root = resolve('.local');
const data = join(root,'postgres');
let env = {...loadEnv('development',process.cwd(),''),...process.env};
const port = Number(env.PG_PORT || 55432);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PG_PORT debe ser un puerto entre 1024 y 65535.');
const bin = env.PG_BIN || (process.platform === 'win32' ? 'C:/Program Files/PostgreSQL/18/bin' : '');
const executable = name => bin ? join(bin,`${name}${process.platform==='win32'?'.exe':''}`) : name;
const run = (name,args,required=true) => {
  const result = spawnSync(executable(name),args,{windowsHide:true,encoding:'utf8',timeout:30000});
  if (required && result.status!==0) throw new Error(result.error?.message || result.stderr || result.stdout || `${name} falló`);
  return result;
};
if (action==='status') { console.log(run('pg_ctl',['-D',data,'status'],false).stdout); process.exit(0); }
if (action==='stop') { run('pg_ctl',['-D',data,'stop','-m','fast']); console.log('PostgreSQL del CRM detenido.'); process.exit(0); }
mkdirSync(root,{recursive:true});
if (!existsSync(join(data,'PG_VERSION'))) {
  if (env.DATABASE_URL || env.DATABASE_ADMIN_URL) throw new Error('Ya existe configuración de PostgreSQL. Usa db:migrate para esa base o configura otro directorio de trabajo.');
  const adminPassword = randomBytes(32).toString('hex');
  const apiPassword = randomBytes(32).toString('hex');
  const passwordFile = join(root,'init-password');
  writeFileSync(passwordFile,adminPassword,{mode:0o600});
  try { run('initdb',['-D',data,'-U','postgres','--pwfile',passwordFile,'--auth=scram-sha-256','--encoding=UTF8','--locale=C']); }
  finally { unlinkSync(passwordFile); }
  const envPath=resolve('.env.local');
  const existing=existsSync(envPath)?readFileSync(envPath,'utf8'):'';
  writeFileSync(envPath,`${existing}\nVITE_BACKEND=local\nPG_PORT=${port}\nDATABASE_URL=postgresql://she_api:${apiPassword}@127.0.0.1:${port}/she_crm\nDATABASE_ADMIN_URL=postgresql://postgres:${adminPassword}@127.0.0.1:${port}/she_crm\nALLOW_REGISTRATION=false\nCOOKIE_SECURE=false\n`,{mode:0o600});
  env=loadEnv('development',process.cwd(),'');
}
if (!env.DATABASE_ADMIN_URL) throw new Error('Falta DATABASE_ADMIN_URL en .env.local.');
const adminUrl=new URL(env.DATABASE_ADMIN_URL);
if (adminUrl.hostname!=='127.0.0.1' || Number(adminUrl.port)!==port || adminUrl.pathname!=='/she_crm') throw new Error(`db:local administra únicamente la instancia aislada 127.0.0.1:${port}/she_crm.`);
if (run('pg_ctl',['-D',data,'status'],false).status!==0) run('pg_ctl',['-D',data,'-l',join(root,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']);
adminUrl.pathname='/postgres';
const client=new pg.Client({connectionString:adminUrl.href});
await client.connect();
try { if (!(await client.query("select 1 from pg_database where datname='she_crm'")).rowCount) await client.query('create database she_crm'); }
finally { await client.end(); }
console.log(`PostgreSQL del CRM disponible en 127.0.0.1:${port}. Ejecuta npm run db:migrate.`);
