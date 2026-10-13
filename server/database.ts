import pg from 'pg';
import type { PoolClient } from 'pg';
// Preserve date-only values without timezone conversion.
pg.types.setTypeParser(1082, value => value);
let pool: pg.Pool | null;
export function database() {
  if (!process.env.DATABASE_URL) throw Object.assign(new Error('Configura DATABASE_URL en el servidor.'), { status: 503 });
  if (new URL(process.env.DATABASE_URL).username !== 'she_api') throw Object.assign(new Error('DATABASE_URL debe usar el rol restringido she_api.'),{status:503});
  if (!pool) {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10,
      connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000, statement_timeout: 10000 });
    pool.on('error',error=>console.error('PostgreSQL idle connection failure','code' in error ? error.code : error.name));
  }
  return pool;
}
export async function closeDatabase() { if (pool) { await pool.end(); pool = null; } }
export async function transaction<T>(callback: (client: PoolClient) => Promise<T>, userId?: string, readOnly = false): Promise<T> {
  const client = await database().connect();
  try {
    await client.query(readOnly ? 'begin isolation level repeatable read read only' : 'begin');
    if (userId) {
      await client.query('set local role authenticated');
      await client.query("select set_config('request.jwt.claim.sub',$1,true)", [userId]);
    }
    const result = await callback(client);
    await client.query('commit');
    return result;
  } catch (error) { await client.query('rollback'); throw error; }
  finally { client.release(); }
}
