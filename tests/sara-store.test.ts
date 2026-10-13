import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSaraStore, projectSnapshot } from '../server/sara-store.js';
import { seed } from '../src/data.ts';

const columns=[{name:'whatsapp_id',type:'string'},{name:'nombre',type:'string'},{name:'muestra_solicitada',type:'boolean'}];
const lead={id:8,whatsapp_id:'contacto-unitario',nombre:'Contacto unitario',canal_origen:'WhatsApp',etapa_pipeline:'cotizacion',pedido_solicitado:true,estado_pedido:'pago_reportado',muestra_solicitada:true,muestra_pago_estado:'Comprobante recibido',custom_future_field:'Conservar este campo',fecha_creacion:'2026-10-12T10:00:00Z'};
const snapshot=(rows:any[],messages:any[]=[])=>({schemaVersion:1,columns,rows,messages});

test('el arranque no contiene clientes, pedidos ni conversaciones ficticias',()=>{
  const state=seed();
  for(const collection of ['clients','orders','conversations','opportunities','samples','quotes'])assert.deepEqual(state[collection],[]);
});
test('una solicitud no crea venta ni pago confirmado y conserva campos nuevos',()=>{
  const state:any=projectSnapshot([lead]);
  assert.equal(state.orders.length,0);assert.equal(state.quotes.length,0);
  assert.equal(state.opportunities[0].amount,null);
  assert.equal(state.samples[0].payment,'Comprobante recibido');
  assert.deepEqual(state.clients[0].sara,lead);
  const unconfirmed:any=projectSnapshot([{...lead,estado_llamada:'propuesta',google_calendar_event_id:'id-real',fecha_llamada_confirmada:'2026-10-12T12:00:00Z'}]);
  assert.equal(unconfirmed.appointments.length,0);
});
test('persistencia, importación idempotente, rechazo de datos inválidos y control de revisión',()=>{
  const directory=mkdtempSync(join(tmpdir(),'sara-crm-test-'));
  const path=join(directory,'test.sqlite');let store:any;
  try{
    store=openSaraStore(path);store.importSnapshot(snapshot([lead]));
    const first=store.snapshot();
    store.importSnapshot(snapshot([lead]));assert.equal(store.snapshot().revision,first.revision);
    assert.throws(()=>store.importSnapshot(snapshot([{id:9}])));assert.equal(store.snapshot().state.clients.length,1);
    const client=first.state.clients[0];
    store.save(first.revision,[{collection:'clients',id:client.id,operation:'put',value:{...client,legal:'Razón social capturada por el equipo'}}]);
    assert.throws(()=>store.save(first.revision,[]),/Recarga/);
    store.importSnapshot(snapshot([{...lead,nombre:'Nombre corregido por el cliente',ciudad:'Ciudad nueva'}]));
    assert.equal(store.snapshot().state.clients[0].legal,'Razón social capturada por el equipo');
    assert.equal(store.snapshot().state.clients[0].sara.ciudad,'Ciudad nueva');
    assert.equal(store.snapshot().state.clients[0].contact,'Nombre corregido por el cliente');
    store.close();store=openSaraStore(path);assert.equal(store.snapshot().state.clients.length,1);
  }finally{store?.close();rmSync(directory,{recursive:true,force:true});}
});
test('captura previa al modelo y análisis posterior conservan identidad y mensajes sin duplicados',()=>{
  const directory=mkdtempSync(join(tmpdir(),'sara-crm-history-'));const store:any=openSaraStore(join(directory,'test.sqlite'));
  const message={message_key:'client:mensaje-real-unitario',contact_id:'contacto-unitario',actor:'client',text:'Consulta recibida',occurred_at:'2026-10-12T10:00:00Z',canal_origen:'WhatsApp'};
  try{
    store.importSnapshot(snapshot([], [message]));const pending=store.snapshot().state.clients[0];
    assert.equal(pending.sara.captured_without_ai,true);assert.equal(pending.sara.nombre,null);
    store.importSnapshot(snapshot([lead],[message,message]));const state=store.snapshot().state;
    assert.equal(state.clients.length,1);assert.equal(state.clients[0].id,pending.id);
    assert.equal(state.conversations[0].messages.length,1);
    assert.equal(state.conversations[0].messages[0].text,'Consulta recibida');
  }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});
