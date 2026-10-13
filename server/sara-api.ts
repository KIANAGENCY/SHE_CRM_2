import { openSaraStore } from './sara-store.ts';
import { readRawBody, sendJson } from './webhook-utils.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
let store: ReturnType<typeof openSaraStore>;
const localStore = () => store ||= openSaraStore();
export async function saraApi(req: IncomingMessage,res: ServerResponse) {
  try {
    res.setHeader('Cache-Control','no-store'); res.setHeader('X-Content-Type-Options','nosniff');
    const host = req.headers.host;
    if (!host || !/^(127\.0\.0\.1|localhost):\d+$/.test(host) || !['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return sendJson(res,403,{error:'Acceso exclusivamente local.'});
    if (req.headers['sec-fetch-site']==='cross-site' || (req.headers.origin && req.headers.origin !== `http://${host}`)) return sendJson(res,403,{error:'Origen no autorizado.'});
    const url = new URL(req.url,`http://${host}`);
    const path = url.pathname.slice('/api/sara'.length);
    if (req.method==='GET' && path==='/state') {
      await localStore().refresh(); return sendJson(res,200,localStore().snapshot());
    }
    if (req.method!=='POST' || req.headers.origin !== `http://${host}`) return sendJson(res,405,{error:'Método no permitido.'});
    if (!req.headers['content-type']?.startsWith('application/json')) return sendJson(res,415,{error:'Se requiere JSON.'});
    const body = JSON.parse((await readRawBody(req)).toString('utf8'));
    if (path==='/refresh') { await localStore().refresh(true); return sendJson(res,200,localStore().snapshot()); }
    if (path==='/sync') return sendJson(res,200,{revision:localStore().save(body.revision,body.changes,body.discountLimit)});
    return sendJson(res,404,{error:'Ruta desconocida.'});
  } catch(error) { return sendJson(res,error.status || 500,{error:error.status ? error.message:'No se pudo procesar la operación local.'}); }
}
