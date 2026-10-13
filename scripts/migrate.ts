import pg from 'pg';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadEnv } from 'vite';
import { pathToFileURL } from 'node:url';

export async function migrate(connectionString: string) {
  if (!connectionString) throw new Error('Falta DATABASE_ADMIN_URL.');
  const client = new pg.Client({connectionString});
  await client.connect();
  try {
    await client.query('begin');
    await client.query('select pg_advisory_xact_lock(90121013)');
    await client.query(await readFile(new URL('../database/bootstrap.sql',import.meta.url),'utf8'));
    await client.query('create table if not exists public.schema_migrations(name text primary key,checksum text not null,applied_at timestamptz not null default now())');
    for (const directory of ['../supabase/migrations/','../database/migrations/']) {
      const root = new URL(directory,import.meta.url);
      for (const file of (await readdir(root)).filter(x=>x.endsWith('.sql')).sort()) {
        const sql = await readFile(new URL(file,root),'utf8');
        const checksum = createHash('sha256').update(sql).digest('hex');
        const previous = (await client.query('select checksum from public.schema_migrations where name=$1',[file])).rows[0];
        if (previous) {
          if (previous.checksum !== checksum) throw new Error(`Migración aplicada fue modificada: ${file}`);
          continue;
        }
        await client.query(sql);
        await client.query('insert into public.schema_migrations(name,checksum) values($1,$2)',[file,checksum]);
        console.log(`Migración: ${file}`);
      }
    }
    await client.query('commit');
  } catch(error) { await client.query('rollback'); throw error; }
  finally { await client.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = {...loadEnv('development',process.cwd(),''),...process.env};
  await migrate(env.DATABASE_ADMIN_URL);
  if (env.DATABASE_URL) {
    const target = new URL(env.DATABASE_URL);
    if (target.username !== 'she_api') throw new Error('DATABASE_URL debe usar el rol restringido she_api.');
    const client = new pg.Client({connectionString:env.DATABASE_ADMIN_URL});
    await client.connect();
    try {
      // PostgreSQL does not accept bind parameters in ALTER ROLE; quote as a literal.
      const literal = (await client.query('select quote_literal($1) as value',[decodeURIComponent(target.password)])).rows[0].value;
      await client.query(`alter role she_api password ${literal}`);
    } finally { await client.end(); }
  }
  console.log('Base de datos lista.');
}
