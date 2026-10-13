import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { loadEnv } from 'vite';
import { migrate } from './migrate.ts';
const env={...loadEnv('development',process.cwd(),''),...process.env};
if (!env.DATABASE_ADMIN_URL || !env.DATABASE_URL) throw new Error('Configura PostgreSQL y ejecuta db:migrate primero.');
const admin=new pg.Client({connectionString:env.DATABASE_ADMIN_URL});
await admin.connect();
const name=`she_crm_test_${randomBytes(6).toString('hex')}`;
let created=false;
try {
  await admin.query(`create database ${name}`); created=true;
  const testAdmin=new URL(env.DATABASE_ADMIN_URL); testAdmin.pathname=`/${name}`;
  const testApp=new URL(env.DATABASE_URL); testApp.pathname=`/${name}`;
  await migrate(testAdmin.href);
  // Re-run to verify checksum-based, idempotent migration execution.
  await migrate(testAdmin.href);
  const child=spawn(process.execPath,['--import','tsx','--test','tests/postgres.integration.ts'],{stdio:'inherit',windowsHide:true,
    env:{...env,DATABASE_URL:testApp.href,TEST_DATABASE_ADMIN_URL:testAdmin.href,ALLOW_REGISTRATION:'true',APP_ORIGIN:'',COOKIE_SECURE:'false'}});
  const code=await new Promise<number | null>((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
  process.exitCode=code??1;
} finally {
  // Only the database created in this invocation may be dropped.
  if(created && /^she_crm_test_[a-f0-9]{12}$/.test(name)) await admin.query(`drop database ${name} with (force)`);
  await admin.end();
}
