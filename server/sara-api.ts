import { openSaraStore } from './sara-store.ts';
import { readRawBody, sendJson } from './webhook-utils.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { saraAccess, saraClientAddress } from './sara-access.ts';
import { openSaraSessions, requiresSaraLogin, saraContext, saraCookie, saraToken } from './sara-session.ts';
let store: ReturnType<typeof openSaraStore>;
let sessions: ReturnType<typeof openSaraSessions>;
const localStore = () => store ||= openSaraStore();
const sessionStore = () => sessions ||= openSaraSessions(process.env.SARA_AUTH_DATABASE);
export function closeSaraResources() {
  store?.close();sessions?.close();store=undefined;sessions=undefined;
}
export async function saraApi(req: IncomingMessage,res: ServerResponse) {
  try {
    res.setHeader('Cache-Control','no-store'); res.setHeader('X-Content-Type-Options','nosniff');
    const accessError = saraAccess(req);
    if (accessError) return sendJson(res,accessError,{error:accessError === 503 ? 'Configura el acceso protegido de SARA.' : 'Acceso no autorizado.'});
    const url = new URL(req.url,'http://localhost');
    const path = url.pathname.slice('/api/sara'.length);
    if (req.method === 'GET' && path === '/session') {
      const context = requiresSaraLogin() ? sessionStore().current(saraToken(req)) : { ...saraContext('Acceso en esta computadora'), localOnly:true };
      return sendJson(res,200,{context});
    }
    if (req.method === 'POST' && path === '/auth/logout') {
      if (requiresSaraLogin()) sessionStore().logout(saraToken(req));
      saraCookie(res,'',0);
      return sendJson(res,200,{ok:true});
    }
    if (req.method === 'POST' && path === '/auth/login') {
      if (!req.headers['content-type']?.startsWith('application/json')) return sendJson(res,415,{error:'Se requiere JSON.'});
      let body: { username?: unknown; password?: unknown };
      try { body = JSON.parse((await readRawBody(req)).toString('utf8')); }
      catch(error) { if(error.status)throw error; return sendJson(res,400,{error:'JSON inválido.'}); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return sendJson(res,400,{error:'Indica tu usuario y contraseña.'});
      const result = await sessionStore().login(body.username,body.password,saraClientAddress(req));
      saraCookie(res,result.token);
      return sendJson(res,200,{context:result.context});
    }
    if (requiresSaraLogin() && !sessionStore().current(saraToken(req))) return sendJson(res,401,{error:'Inicia sesión para continuar.'});
    if (req.method==='GET' && path==='/state') {
      await localStore().refresh(); return sendJson(res,200,localStore().snapshot());
    }
    if (req.method!=='POST') return sendJson(res,405,{error:'Método no permitido.'});
    if (!req.headers['content-type']?.startsWith('application/json')) return sendJson(res,415,{error:'Se requiere JSON.'});
    const body = JSON.parse((await readRawBody(req)).toString('utf8'));
    if (path==='/refresh') { await localStore().refresh(true); return sendJson(res,200,localStore().snapshot()); }
    if (path==='/sync') return sendJson(res,200,{revision:localStore().save(body.revision,body.changes,body.discountLimit)});
    return sendJson(res,404,{error:'Ruta desconocida.'});
  } catch(error) { return sendJson(res,error.status || 500,{error:error.status ? error.message:'No se pudo procesar la operación local.'}); }
}
