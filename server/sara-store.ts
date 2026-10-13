import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { products, aromas } from './sara-catalog.ts';

const collections = ['clients','opportunities','products','aromas','quotes','orders','samples','appointments','tasks','notifications','audit','conversations'] as const;
type Collection = typeof collections[number];
export type SaraLead = Record<string, unknown>;
export interface SaraRecord extends Record<string, unknown> { id: string; sara?: SaraLead }
export interface SaraMessage extends Record<string, unknown> { message_key: string; contact_id: string; actor: string; text?: string; occurred_at?: string }
export interface SaraColumn { name: string; type?: string }
export interface SaraSnapshot { schemaVersion: number; rows: SaraLead[]; messages?: SaraMessage[]; columns: SaraColumn[] }
export interface SaraChange { collection: Collection; id: string; operation: 'put' | 'delete'; value?: SaraRecord }
export type SaraState = Record<Collection, SaraRecord[]> & {
  version: number; initialized: boolean; role: string; discountLimit: number;
  saraSync?: { source: string; count: number; lastSync: string | null; error: string; columns: SaraColumn[]; revision: number; intervalMinutes: number };
};
function isCollection(value: string): value is Collection { return collections.some(collection => collection === value); }
const text = (value: unknown): string => value == null ? '' : String(value);
const day = (value: unknown) => /^\d{4}-\d{2}-\d{2}/.test(text(value)) ? text(value).slice(0,10) : '';
const stage = (value: unknown) => ['cotizacion','negociacion'].includes(text(value)) ? 2 : ['pedido','pago_pendiente','cliente'].includes(text(value)) ? 3 : value === 'nuevo' ? 0 : 1;

export function projectLead(row: SaraLead) {
  const id = `sara-${createHash('sha256').update(text(row.whatsapp_id)).digest('hex').slice(0,24)}`;
  return {
    id, name:text(row.hotel_empresa || row.nombre || row.telefono || row.whatsapp_id),
    contact:text(row.nombre), legal:'', rfc:'', address:text(row.direccion_entrega),
    position:text(row.cargo), phone:text(row.telefono || (row.canal_origen === 'WhatsApp' ? row.whatsapp_id : '')),
    email:text(row.correo), owner:'Sara IA', lastOrder:null, created:day(row.fecha_creacion || row.createdAt),
    aroma:'', notes:text(row.resumen_conversacion), channel:text(row.canal_origen), sara:row,
  };
}

export function projectSnapshot(rows: SaraLead[], messages: SaraMessage[] = []): SaraState {
  const state: SaraState = {version:2,initialized:true,role:'Dirección',discountLimit:0,
    clients:[],opportunities:[],products:[],aromas:[],quotes:[],orders:[],samples:[],appointments:[],tasks:[],notifications:[],audit:[],conversations:[]};
  state.products=structuredClone(products); state.aromas=structuredClone(aromas);
  for (const row of rows) {
    const client = projectLead(row);
    state.clients.push(client);
    state.opportunities.push({id:`${client.id}-op`,clientId:client.id,stage:stage(row.etapa_pipeline),route:row.muestra_solicitada === true ? 'sample':'direct',amount:null,next:text(row.ultima_accion_sara || row.problema_principal || (row.captured_without_ai ? 'Pendiente de análisis de SARA':'')),owner:'Sara IA',created:client.created,source:'sara',saraStage:text(row.etapa_pipeline)});
    if (row.muestra_solicitada === true) state.samples.push({id:`${client.id}-muestra`,clientId:client.id,opportunityId:`${client.id}-op`,status:'Solicitada',aroma:'',result:'',tracking:'',source:'sara',payment:text(row.muestra_pago_estado),shippingAccepted:row.muestra_cargo_aceptado === true});
    if (row.google_calendar_event_id && row.estado_llamada === 'confirmada' && Number.isFinite(Date.parse(text(row.fecha_llamada_confirmada)))) state.appointments.push({id:`${client.id}-cita`,clientId:client.id,owner:'Comercial',start:row.fecha_llamada_confirmada,duration:30,type:'Llamada',source:'sara',meet:text(row.google_meet_url),reference:text(row.meeting_reference),eventId:row.google_calendar_event_id});
    if (row.proximo_seguimiento) state.tasks.push({id:`${client.id}-tarea`,clientId:client.id,title:`Seguimiento: ${row.proximo_seguimiento}`,source:'sara'});
    const history = messages.filter(m=>m.contact_id === row.whatsapp_id).sort((a,b)=>text(a.occurred_at).localeCompare(text(b.occurred_at)));
    state.conversations.push({id:`sara-chat-${row.id}`,clientId:client.id,human:row.requiere_humano === true || row.human_manual_block === true,source:'sara',summary:text(row.resumen_conversacion),messages:history.map(m=>({by:m.actor === 'sara' ? 'Sara IA':'Cliente',text:text(m.text),at:m.occurred_at}))});
  }
  return state;
}

export function openSaraStore(path = resolve('.local/sara-crm.sqlite')) {
  mkdirSync(resolve(path,'..'),{recursive:true});
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS leads(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS local_records(collection TEXT NOT NULL,id TEXT NOT NULL,payload TEXT,deleted INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(collection,id));`);
  const get = (key: string): string | undefined => {
    const value = db.prepare('SELECT value FROM meta WHERE key=?').get(key)?.value;
    return value == null ? undefined : String(value);
  };
  const put = (key: string,value: string | number) => db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,String(value));
  const revision = () => Number(get('revision') || 0);
  let pending: Promise<void> | null, lastAttempt = 0;
  const ttl = 5 * 60 * 1000;
  function importSnapshot(snapshot: SaraSnapshot) {
    if (snapshot?.schemaVersion !== 1 || !Array.isArray(snapshot.rows) || snapshot.rows.length > 100000 || !Array.isArray(snapshot.columns)) throw new Error('La respuesta de n8n no tiene el formato esperado.');
    if (snapshot.rows.some(r=>!r || !r.whatsapp_id || r.id == null || typeof r.whatsapp_id !== 'string')) throw new Error('n8n devolvió un contacto inválido.');
    const incomingMessages = snapshot.messages || [];
    if (!Array.isArray(incomingMessages) || incomingMessages.some(m=>!m?.message_key || !m.contact_id || !['client','sara'].includes(m.actor))) throw new Error('Historial inválido.');
    const fingerprint = createHash('sha256').update(JSON.stringify([snapshot.rows,incomingMessages,snapshot.columns])).digest('hex');
    db.exec('BEGIN IMMEDIATE');
    try {
      if (fingerprint !== get('fingerprint')) {
        const lead = db.prepare('INSERT INTO leads(id,payload) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload');
        for (const row of snapshot.rows) lead.run(String(row.id),JSON.stringify(row));
        const message = db.prepare('INSERT INTO messages(id,payload) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload');
        for (const row of incomingMessages) message.run(row.message_key,JSON.stringify(row));
        put('revision',revision()+1); put('fingerprint',fingerprint);
      }
      put('columns',JSON.stringify(snapshot.columns)); put('lastSync',new Date().toISOString()); put('error','');
      db.exec('COMMIT');
    } catch(error) { db.exec('ROLLBACK'); throw error; }
  }
  async function refresh(force=false) {
    if (pending) return pending;
    if (!force && Date.now()-lastAttempt < ttl) return;
    lastAttempt = Date.now();
    pending = (async()=>{
      try {
        const config = JSON.parse(readFileSync(resolve('.local/sara-connection.json'),'utf8'));
        const url = new URL(config.url);
        if (url.protocol !== 'https:' || url.hostname !== 'anluxagency.app.n8n.cloud' || !url.pathname.startsWith('/webhook/')) throw new Error('Destino de n8n inválido.');
        const response = await fetch(url,{headers:{'x-sara-crm-token':config.token},signal:AbortSignal.timeout(20000),redirect:'error'});
        if (!response.ok) throw new Error(`n8n respondió HTTP ${response.status}.`);
        const body = await response.text();
        if (Buffer.byteLength(body)>20*1024*1024) throw new Error('La respuesta excede el tamaño permitido.');
        importSnapshot(JSON.parse(body));
      } catch(error) {
        put('error',error.code === 'ENOENT' ? 'La conexión de SARA está pendiente de configuración.' : error.message === 'fetch failed' ? 'No fue posible conectar con n8n.' : error.message);
      }
      finally { pending = null; }
    })();
    return pending;
  }
  function snapshot() {
    const rows: SaraLead[] = db.prepare('SELECT payload FROM leads ORDER BY CAST(id AS INTEGER),id').all().map(r=>JSON.parse(text(r.payload)));
    const messages: SaraMessage[] = db.prepare('SELECT payload FROM messages').all().map(r=>JSON.parse(text(r.payload)));
    const keys = new Set(rows.map(row=>row.whatsapp_id));
    const columns: SaraColumn[] = JSON.parse(get('columns') || '[]');
    for (const message of messages) {
      if (keys.has(message.contact_id)) continue;
      const history = messages.filter(m=>m.contact_id===message.contact_id).sort((a,b)=>text(a.occurred_at).localeCompare(text(b.occurred_at)));
      const first=history[0],last=history.at(-1);
      rows.push({...Object.fromEntries(columns.map(c=>[c.name,null])),id:`pending-${createHash('sha256').update(message.contact_id).digest('hex').slice(0,20)}`,whatsapp_id:message.contact_id,telefono:first.telefono,canal_origen:first.canal_origen,nombre_perfil:first.nombre_perfil,campana_origen:first.campana_origen,fecha_creacion:first.occurred_at,ultima_interaccion:last.occurred_at,etapa_pipeline:'nuevo',captured_without_ai:true});
      keys.add(message.contact_id);
    }
    const state = projectSnapshot(rows,messages);
    for (const record of db.prepare('SELECT * FROM local_records').all()) {
      const collection = text(record.collection);
      if (!isCollection(collection)) continue;
      const list = state[collection], index = list.findIndex(r=>r.id === record.id);
      if (record.deleted) { if(index>=0) list.splice(index,1); continue; }
      const value: SaraRecord = JSON.parse(text(record.payload));
      if (index>=0) list[index] = {...list[index],...value,sara:list[index].sara}; else list.push(value);
    }
    state.discountLimit = Number(get('discountLimit') || 0);
    state.saraSync = {source:'n8n',count:rows.length,lastSync:get('lastSync') || null,error:get('error') || '',columns:JSON.parse(get('columns') || '[]'),revision:revision(),intervalMinutes:5};
    return {state,revision:revision()};
  }
  function save(expected: number,changes: SaraChange[],discountLimit?: number) {
    if (!Array.isArray(changes) || changes.length>1000) throw Object.assign(new Error('Cambios inválidos.'),{status:400});
    db.exec('BEGIN IMMEDIATE');
    try {
      if (expected !== revision()) throw Object.assign(new Error('SARA actualizó los datos. Recarga antes de guardar.'),{status:409});
      const upsert = db.prepare('INSERT INTO local_records(collection,id,payload,deleted) VALUES(?,?,?,?) ON CONFLICT(collection,id) DO UPDATE SET payload=excluded.payload,deleted=excluded.deleted');
      for (const change of changes) {
        if (!collections.includes(change.collection) || typeof change.id !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(change.id) || !['put','delete'].includes(change.operation)) throw Object.assign(new Error('Registro inválido.'),{status:400});
        if (change.operation === 'delete' && !['tasks','appointments'].includes(change.collection)) throw Object.assign(new Error('No se permite borrar este registro.'),{status:400});
        let value = change.value;
        if (change.operation === 'put' && (!value || value.id !== change.id || JSON.stringify(value).length>200000)) throw Object.assign(new Error('Datos inválidos.'),{status:400});
        if (value) {
          value=structuredClone(value); delete value.sara; delete value.source;
          if (change.id.startsWith('sara-')) {
            const current=snapshot().state[change.collection].find(record=>record.id===change.id);
            const existing=db.prepare('SELECT payload FROM local_records WHERE collection=? AND id=?').get(change.collection,change.id);
            const patch: SaraRecord=existing?.payload ? JSON.parse(text(existing.payload)):{id:change.id};
            for (const [key,input] of Object.entries(value)) if (key!=='id' && JSON.stringify(current?.[key])!==JSON.stringify(input)) patch[key]=input;
            value=patch;
          }
        }
        upsert.run(change.collection,change.id,value ? JSON.stringify(value):null,change.operation==='delete' ? 1:0);
      }
      if (discountLimit !== undefined) {
        if (!Number.isFinite(discountLimit) || discountLimit<0 || discountLimit>100) throw Object.assign(new Error('Descuento inválido.'),{status:400});
        put('discountLimit',discountLimit);
      }
      put('revision',revision()+1); db.exec('COMMIT'); return revision();
    } catch(error) { db.exec('ROLLBACK'); throw error; }
  }
  return {refresh,snapshot,save,importSnapshot,close:()=>db.close()};
}
