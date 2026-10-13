import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PoolClient } from 'pg';
import type { AuthUser, AuthBody } from './auth.ts';
import { database, transaction } from './database.ts';
import { authenticate, cookie, currentUser, fail, hashPassword, hashToken, sessionToken } from './auth.ts';
import { readRawBody, sendJson } from './webhook-utils.ts';

// SQL identifiers come exclusively from these allowlists, never from request text.
const columns: Record<string, string> = {
  clients: 'name legal_name rfc address contact position phone email owner_name last_order created_on aroma notes channel',
  products: 'name size price sku', aromas: 'name family notes intensity areas product_ids approved',
  opportunities: 'client_id stage route amount next_action owner_name created_on',
  quotes: 'client_id lines subtotal discount total valid_until payment shipping delivery channel status version acceptance_reference accepted_at created_at',
  orders: 'client_id opportunity_id quote_id total status confirmed created_on due_on tracking channel invoice_amount delivered_on',
  samples: 'opportunity_id client_id status aroma result tracking',
  appointments: 'client_id owner_name start_at duration type', tasks: 'client_id title',
  conversations: 'client_id human messages', crm_settings: 'discount_limit initialized',
};
const readTables = [...Object.keys(columns), 'notifications', 'audit_log'];
const labels = { owner: 'Dirección', admin: 'Administración', sales: 'Ventas', production: 'Producción' };
type Role = keyof typeof labels;
interface CrmContext { user: AuthUser; workspace: { id: string; name: string }; role: Role; roleLabel: string }
interface CrmBody extends AuthBody { workspace?: string; role?: string; revision?: unknown; changes?: unknown; orderId?: unknown }
function validateFields(values: Record<string, unknown>) {
  const numeric=['stage','amount','price','subtotal','discount','total','shipping','version','invoice_amount','duration','discount_limit'];
  const booleans=['approved','confirmed','human','initialized'];
  const nullable=['last_order','shipping','acceptance_reference','accepted_at','opportunity_id','quote_id','due_on','delivered_on'];
  for(const [key,value] of Object.entries(values)) {
    if (value===null && nullable.includes(key)) continue;
    if (numeric.includes(key)) {
      if (typeof value!=='number' || !Number.isFinite(value) || (['stage','version','duration'].includes(key) && !Number.isInteger(value))) throw fail(400,`Valor numérico inválido: ${key}.`);
    } else if (booleans.includes(key)) {
      if (typeof value!=='boolean') throw fail(400,`Valor booleano inválido: ${key}.`);
    } else if (['lines','messages','product_ids'].includes(key)) {
      if (!Array.isArray(value) || value.length>1000) throw fail(400,`Lista inválida: ${key}.`);
      if (key==='product_ids' && value.some(id=>typeof id!=='string'||id.length>120)) throw fail(400,'Productos inválidos.');
      if (key==='messages' && value.some(message=>!message||typeof message.by!=='string'||typeof message.text!=='string'||message.text.length>20000)) throw fail(400,'Mensaje inválido.');
    } else if (typeof value!=='string' || value.length>20000) throw fail(400,`Texto inválido: ${key}.`);
  }
}
async function context(client: PoolClient, user: AuthUser, workspaceId?: string): Promise<CrmContext> {
  if (workspaceId && !/^[a-f0-9-]{36}$/i.test(workspaceId)) throw fail(400, 'Espacio inválido.');
  const { rows: [membership] } = await client.query<{ role: Role; id: string; name: string }>(`select m.role,w.id,w.name from public.workspace_members m
    join public.workspaces w on w.id=m.workspace_id where m.user_id=$1 ${workspaceId ? 'and w.id=$2' : ''} order by m.created_at,w.id limit 1`, workspaceId ? [user.id,workspaceId] : [user.id]);
  if (!membership) throw fail(403, 'No tienes acceso a este espacio.');
  return { user, workspace: { id: membership.id, name: membership.name }, role: membership.role, roleLabel: labels[membership.role] };
}
async function revision(client: PoolClient, workspace: string, expected: unknown) {
  const { rows: [row] } = await client.query<{ revision: string }>('select revision from public.workspace_revisions where workspace_id=$1 for update', [workspace]);
  if (!row || String(expected) !== row.revision) throw fail(409, 'Otro usuario modificó los datos. Recarga el CRM antes de guardar de nuevo.');
}
async function bump(client: PoolClient, workspace: string) {
  const { rows: [row] } = await client.query<{ revision: string }>('update public.workspace_revisions set revision=revision+1 where workspace_id=$1 returning revision', [workspace]);
  return row.revision;
}
async function audit(client: PoolClient, ctx: CrmContext, action: string) {
  await client.query('insert into public.audit_log(workspace_id,id,actor,action) values($1,$2,$3,$4)', [ctx.workspace.id,randomUUID(),ctx.user.email,action]);
}
async function sync(client: PoolClient, ctx: CrmContext, changes: unknown) {
  if (!Array.isArray(changes) || changes.length > 1000) throw fail(400, 'Se permiten hasta 1000 cambios por transacción.');
  if (ctx.role === 'production') throw fail(403, 'Producción solo puede registrar el empaque.');
  for (const change of changes) {
    if (!change || typeof change !== 'object') throw fail(400, 'Cambio inválido.');
    const { table, id, operation, values } = change;
    if (!Object.hasOwn(columns, table) || !['insert','update','delete'].includes(operation)) throw fail(400, 'Operación no permitida.');
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(id)) throw fail(400, 'Identificador inválido.');
    if (ctx.role === 'sales' && (['products','aromas','crm_settings'].includes(table) || (table === 'orders' && operation !== 'insert'))) throw fail(403, 'Tu perfil no permite esta operación.');
    if (table === 'crm_settings' && (operation !== 'update' || id !== ctx.workspace.id)) throw fail(400, 'Ajustes inválidos.');
    const predicate = table === 'crm_settings' ? 'workspace_id=$1' : 'workspace_id=$1 and id=$2';
    const keys = table === 'crm_settings' ? [ctx.workspace.id] : [ctx.workspace.id,id];
    const before = (await client.query(`select * from public.${table} where ${predicate}`, keys)).rows[0];
    if (operation !== 'insert' && !before) throw fail(404, 'Registro no encontrado.');
    if (operation === 'insert' && before) throw fail(409, 'El registro ya existe.');
    if (operation === 'delete') {
      if (!['appointments','tasks'].includes(table)) throw fail(400, 'La API solo elimina citas y tareas.');
      const result = await client.query(`delete from public.${table} where ${predicate}`, keys);
      if (!result.rowCount) throw fail(403, 'Operación denegada.');
    } else {
      if (!values || typeof values !== 'object' || Array.isArray(values)) throw fail(400, 'Campos inválidos.');
      const fields = Object.keys(values);
      if (!fields.length || fields.some(field => !columns[table].split(' ').includes(field))) throw fail(400, 'Campo no permitido.');
      validateFields(values);
      const parameters = fields.map(field => ['lines','messages'].includes(field) ? JSON.stringify(values[field]) : values[field]);
      let result;
      if (operation === 'insert') {
        result = await client.query(`insert into public.${table}(workspace_id,id,${fields.join(',')}) values(${[...keys,...parameters].map((_,i)=>`$${i+1}`).join(',')}) returning *`, [...keys,...parameters]);
      } else {
        result = await client.query(`update public.${table} set ${fields.map((field,i)=>`${field}=$${i+keys.length+1}`).join(',')} where ${predicate} returning *`, [...keys,...parameters]);
      }
      if (!result.rowCount) throw fail(403, 'Operación denegada.');
      if (table === 'orders' && (operation === 'insert' || before.status !== result.rows[0].status)) {
        const event = operation === 'insert' ? 'Pedido confirmado' : result.rows[0].status;
        await client.query(`insert into public.notifications(workspace_id,id,event_key,order_id,event,status)
          values($1,$2,$3,$4,$5,'Pendiente de integración') on conflict(workspace_id,event_key) do nothing`, [ctx.workspace.id,randomUUID(),`${id}:${event}`,id,event]);
      }
    }
    await audit(client,ctx,`${operation} ${table}: ${id}`);
  }
}
async function bodyJson(req: IncomingMessage): Promise<CrmBody> {
  if (!req.headers['content-type']?.startsWith('application/json')) throw fail(415, 'Se requiere application/json.');
  let body;
  try { body = JSON.parse((await readRawBody(req)).toString('utf8')); }
  catch (error) { if (error.status) throw error; throw fail(400, 'JSON inválido.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail(400, 'Se requiere un objeto JSON.');
  return body;
}
function sameOrigin(req: IncomingMessage) {
  const expected = process.env.APP_ORIGIN || `http://${req.headers.host}`;
  if (!process.env.APP_ORIGIN && !['localhost','127.0.0.1','[::1]'].includes(new URL(expected).hostname)) throw fail(403, 'Configura APP_ORIGIN para este dominio.');
  if (req.headers.origin !== expected || req.headers['sec-fetch-site'] === 'cross-site') throw fail(403, 'Origen no autorizado.');
}
export async function crmApi(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname.slice('/api/crm'.length);
  try {
    res.setHeader('X-Content-Type-Options','nosniff');
    if (req.method === 'GET' && path === '/health') {
      await database().query('select 1');
      return sendJson(res,200,{ok:true,database:'postgresql'});
    }
    if (!['GET','POST'].includes(req.method)) { res.setHeader('Allow','GET, POST'); throw fail(405,'Método no permitido.'); }
    if (req.method === 'POST') sameOrigin(req);
    if (req.method === 'POST' && ['/auth/login','/auth/signup'].includes(path)) {
      const result = await authenticate(req,await bodyJson(req),path.endsWith('signup'));
      cookie(res,result.token);
      return sendJson(res,200,{user:result.user,session:true});
    }
    if (req.method === 'POST' && path === '/auth/logout') {
      await database().query('delete from auth.sessions where token_hash=$1',[hashToken(sessionToken(req))]);
      cookie(res,'',0);
      return sendJson(res,200,{ok:true});
    }
    const user = await currentUser(req);
    if (req.method === 'GET' && path === '/session' && !user) return sendJson(res,200,{context:null});
    if (!user) throw fail(401,'Inicia sesión para continuar.');
    if (req.method === 'GET' && ['/session','/state','/members'].includes(path)) {
      const result = await transaction(async client => {
        const ctx = await context(client,user,url.searchParams.get('workspace'));
        if (path === '/session') return { context:ctx };
        if (path === '/members') return { members:(await client.query('select user_id,role from public.workspace_members where workspace_id=$1',[ctx.workspace.id])).rows };
        const rows: Record<string, Record<string, unknown>[]> = {};
        for (const table of readTables) rows[table] = (await client.query(`select * from public.${table} where workspace_id=$1 order by ${table === 'crm_settings' ? 'workspace_id' : 'id'}`,[ctx.workspace.id])).rows;
        const { rows: [version] } = await client.query('select revision from public.workspace_revisions where workspace_id=$1',[ctx.workspace.id]);
        return {rows,revision:version.revision};
      },user.id,true);
      return sendJson(res,200,result);
    }
    if (req.method === 'POST' && ['/sync','/pack','/members'].includes(path)) {
      const body = await bodyJson(req);
      if (!body.workspace) throw fail(400,'Indica el espacio de trabajo.');
      if (path === '/members') {
        await transaction(async client => {
          const ctx = await context(client,user,body.workspace);
          if (ctx.role !== 'owner' || !['admin','sales','production'].includes(body.role)) throw fail(403,'Solo Dirección administra el equipo.');
        },user.id,true);
      }
      // Perform expensive derivation before opening a transaction.
      const memberHash = path === '/members' && body.password ? await hashPassword(body.password) : null;
      const result = await transaction(async client => {
        const ctx = await context(client,user,body.workspace);
        await revision(client,ctx.workspace.id,body.revision);
        if (path === '/sync') await sync(client,ctx,body.changes);
        if (path === '/pack') {
          if (ctx.role !== 'production') throw fail(403,'Operación reservada para Producción.');
          if (typeof body.orderId !== 'string' || body.orderId.length > 120) throw fail(400,'Pedido inválido.');
          await client.query('select public.pack_order($1,$2)',[ctx.workspace.id,body.orderId]);
        }
        if (path === '/members') {
          if (ctx.role !== 'owner' || !['admin','sales','production'].includes(body.role)) throw fail(403,'Solo Dirección administra el equipo.');
          if (typeof body.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) || body.email.length>254) throw fail(400,'Correo inválido.');
          await client.query('reset role');
          let member = (await client.query('select id from auth.users where email=$1',[body.email.trim().toLowerCase()])).rows[0];
          if (!member) {
            if (!memberHash || typeof body.fullName !== 'string' || body.fullName.trim().length<2 || body.fullName.length>120) throw fail(400,'Indica nombre y contraseña para el nuevo integrante.');
            member = (await client.query('insert into auth.users(email,password_hash,raw_user_meta_data) values($1,$2,$3) returning id',[body.email.trim().toLowerCase(),memberHash,JSON.stringify({full_name:body.fullName.trim(),managed:true})])).rows[0];
          }
          if (member.id === user.id) throw fail(403,'No puedes cambiar tu propio perfil.');
          await client.query('set local role authenticated');
          const prior = (await client.query('select role from public.workspace_members where workspace_id=$1 and user_id=$2',[ctx.workspace.id,member.id])).rows[0];
          if (prior?.role === 'owner') throw fail(403,'No se puede reemplazar Dirección.');
          await client.query('insert into public.workspace_members(workspace_id,user_id,role) values($1,$2,$3) on conflict(workspace_id,user_id) do update set role=excluded.role',[ctx.workspace.id,member.id,body.role]);
          await audit(client,ctx,`Miembro ${member.id}: ${body.role}`);
        }
        return {ok:true,revision:await bump(client,ctx.workspace.id)};
      },user.id);
      return sendJson(res,200,result);
    }
    throw fail(404,'Ruta no encontrada.');
  } catch (error) {
    const mapped = { '23P01':409,'23505':409,'23503':400,'23514':400,'23502':400,'22P02':400,'22007':400,'22008':400,'22003':400,'42501':403,'P0002':404,'22023':400,'40001':409,'40P01':409 };
    const status = error.status || mapped[error.code] || 500;
    const message = error.status ? error.message : status===409 ? 'Conflicto de datos. Recarga e intenta de nuevo.' : status===403 ? 'Permisos insuficientes.' : status===400 ? 'Los datos no cumplen las reglas del CRM.' : status===404 ? 'Registro no encontrado.' : 'No fue posible completar la operación.';
    if (status === 500) console.error('CRM API failure',error.code || error.name);
    return sendJson(res,status,{ok:false,error:message});
  }
}
