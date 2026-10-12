import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import pg from 'pg';
import { crmApi } from '../server/crm-api.js';
import { closeDatabase } from '../server/database.js';

test('API PostgreSQL real: autenticación, aislamiento y transacciones',async t=>{
  assert.match(new URL(process.env.TEST_DATABASE_ADMIN_URL).pathname,/^\/she_crm_test_[a-f0-9]+$/);
  const admin=new pg.Client({connectionString:process.env.TEST_DATABASE_ADMIN_URL});
  await admin.connect();
  const server=createServer(crmApi);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const call=async(path,body,cookie='',extra={})=>{
    const response=await fetch(`${origin}/api/crm${path}`,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie,...extra},body:body?JSON.stringify(body):undefined});
    return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')};
  };
  let owner,other,workspace,revision;
  const change=(table,id,values,operation='insert')=>({table,id,values,operation});
  const write=async changes=>{
    const result=await call('/sync',{workspace,revision,changes},owner);
    if(result.status===200) revision=result.data.revision;
    return result;
  };
  try {
    await t.test('rol de ejecución sin privilegios administrativos',async()=>{
      const runtime=new pg.Client({connectionString:process.env.DATABASE_URL});await runtime.connect();
      try {
        const {rows:[role]}=await runtime.query('select rolsuper,rolbypassrls,rolinherit from pg_roles where rolname=current_user');
        assert.deepEqual(role,{rolsuper:false,rolbypassrls:false,rolinherit:false});
        await assert.rejects(runtime.query('select * from public.clients'),{code:'42501'});
      } finally {await runtime.end();}
    });
    await t.test('registro, cookies y hashes; inicio de sesión',async()=>{
      assert.equal((await call('/state')).status,401);
      assert.equal((await call('/auth/signup',{email:'invalid',password:'short'})).status,400);
      const signup=await call('/auth/signup',{email:'owner@example.test',password:'Owner-test-password!',fullName:'Owner Test',workspaceName:'CRM Test'});
      assert.equal(signup.status,200,JSON.stringify(signup.data));
      assert.match(signup.cookie,/HttpOnly/);assert.match(signup.cookie,/SameSite=Strict/);
      owner=signup.cookie.split(';')[0];
      const session=await call('/session',null,owner);
      workspace=session.data.context.workspace.id;
      assert.equal(session.data.context.role,'owner');
      const hash=(await admin.query("select password_hash from auth.users where email='owner@example.test'")).rows[0].password_hash;
      assert.match(hash,/^[a-f0-9]{32}:[a-f0-9]{128}$/);
      assert.equal((await call('/auth/login',{email:'owner@example.test',password:'wrong-password'})).status,401);
      assert.equal((await call('/auth/login',{email:'owner@example.test',password:'Owner-test-password!'})).status,200);
      revision=(await call(`/state?workspace=${workspace}`,null,owner)).data.revision;
    });
    await t.test('CSRF, campos y SQL arbitrario rechazados',async()=>{
      assert.equal((await call('/sync',{workspace,revision,changes:[]},owner,{Origin:'https://attacker.test'})).status,403);
      assert.equal((await write([change('clients;drop table auth.users','x',{name:'Bad'})])).status,400);
      assert.equal((await write([change('clients','x',{name:'Bad',workspace_id:workspace})])).status,400);
      assert.equal((await write([change('clients','"><img src=x onerror=alert(1)>',{name:'Attack'})])).status,400);
      const response=await fetch(`${origin}/api/crm/sync`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:owner},body:'{'});
      assert.equal(response.status,400);
    });
    await t.test('guardado atómico: rollback ante referencia inválida',async()=>{
      const result=await write([change('clients','rollback-client',{name:'Rollback'}),change('tasks','bad-task',{client_id:'missing',title:'Invalid'})]);
      assert.equal(result.status,400);
      const state=(await call(`/state?workspace=${workspace}`,null,owner)).data;
      assert.equal(state.rows.clients.length,0);assert.equal(state.revision,revision);assert.equal(state.rows.audit_log.length,0);
    });
    await t.test('CRUD, auditoría del servidor y conflictos entre sesiones',async()=>{
      const stale=revision;
      assert.equal((await write([change('clients','c1',{name:'Cliente uno'}),change('tasks','t1',{client_id:'c1',title:'Llamar'})])).status,200);
      assert.equal((await call('/sync',{workspace,revision:stale,changes:[change('clients','c1',{name:'Stale'},'update')]},owner)).status,409);
      assert.equal((await write([change('clients','c1',{phone:'555'},'update'),{table:'tasks',id:'t1',operation:'delete'}])).status,200);
      const state=(await call(`/state?workspace=${workspace}`,null,owner)).data;
      assert.equal(state.rows.clients[0].phone,'555');assert.equal(state.rows.tasks.length,0);
      assert.equal(state.rows.audit_log.length,4);
      assert.ok(state.rows.audit_log.every(row=>row.actor==='owner@example.test'));
      assert.equal((await write([change('audit_log','forged',{actor:'Fake',action:'fake'})])).status,400);
    });
    await t.test('aislamiento entre dos espacios y registro cerrado',async()=>{
      const signup=await call('/auth/signup',{email:'other@example.test',password:'Other-test-password!',fullName:'Other Owner',workspaceName:'Other Workspace'});
      assert.equal(signup.status,200);other=signup.cookie.split(';')[0];
      assert.equal((await call(`/state?workspace=${workspace}`,null,other)).status,403);
      assert.equal((await call('/sync',{workspace,revision,changes:[]},other)).status,403);
      assert.equal((await call('/state',null,other)).data.rows.clients.length,0);
      process.env.ALLOW_REGISTRATION='false';
      assert.equal((await call('/auth/signup',{email:'closed@example.test',password:'Other-test-password!',fullName:'Closed User',workspaceName:'Closed Workspace'})).status,403);
    });
    let sales,production;
    await t.test('Dirección crea equipo; ventas no cambia catálogo ni permisos',async()=>{
      for(const [email,role] of [['sales@example.test','sales'],['production@example.test','production']]) {
        const result=await call('/members',{workspace,revision,email,role,password:'Member-test-password!',fullName:'Test Member'},owner);
        assert.equal(result.status,200,JSON.stringify(result.data));revision=result.data.revision;
        const login=await call('/auth/login',{email,password:'Member-test-password!'});
        assert.equal(login.status,200);
        if(role==='sales')sales=login.cookie.split(';')[0];else production=login.cookie.split(';')[0];
      }
      const ctx=(await call('/session',null,sales)).data.context;
      assert.equal(ctx.workspace.id,workspace);assert.equal(ctx.role,'sales');
      assert.equal((await call('/sync',{workspace,revision,changes:[change('products','p1',{name:'x',sku:'x',price:1})]},sales)).status,403);
      assert.equal((await call('/members',{workspace,revision,email:'sales@example.test',role:'admin'},sales)).status,403);
      // An unauthorized role must be rejected before validating/deriving a password.
      assert.equal((await call('/members',{workspace,revision,email:'sales@example.test',role:'admin',password:'short'},sales)).status,403);
      assert.equal((await call('/sync',{workspace,revision,changes:[change('clients','evil',{name:'x'})]},production)).status,403);
    });
    await t.test('cotizaciones: descuento y total validados en PostgreSQL',async()=>{
      assert.equal((await write([change('products','p1',{name:'Producto',sku:'SKU1',price:100}),change('aromas','a1',{name:'Aroma',approved:true,product_ids:['p1']})])).status,200);
      const quote={client_id:'c1',lines:[{productId:'p1',aromaId:'a1',quantity:2,price:100}],subtotal:200,discount:0,total:200,valid_until:'2099-12-31',status:'Aceptada',acceptance_reference:'Aceptado por correo',accepted_at:new Date().toISOString()};
      assert.equal((await write([change('quotes','bad-q',{...quote,total:1})])).status,400);
      assert.equal((await write([change('quotes','bad-q',{...quote,discount:10,total:180})])).status,400);
      assert.equal((await write([change('quotes','q1',quote),change('orders','o1',{client_id:'c1',quote_id:'q1',total:200,confirmed:true})])).status,200);
      assert.equal((await write([change('orders','o1',{status:'Entregado'},'update')])).status,400);
      assert.equal((await write([change('quotes','q1',{client_id:'different'},'update')])).status,400);
    });
    await t.test('agenda sin solapamientos y muestras con autorización',async()=>{
      const appointment={client_id:'c1',owner_name:'Vendedor',start_at:'2099-01-01T10:00:00Z',duration:30,type:'Llamada'};
      assert.equal((await write([change('appointments','ap1',appointment)])).status,200);
      assert.equal((await write([change('appointments','ap2',{...appointment,start_at:'2099-01-01T10:15:00Z'})])).status,409);
      assert.equal((await write([change('appointments','ap2',{...appointment,start_at:'2099-01-01T10:30:00Z'})])).status,200);
      assert.equal((await write([change('opportunities','op1',{client_id:'c1',route:'sample'}),change('samples','s1',{client_id:'c1',opportunity_id:'op1'})])).status,200);
      assert.equal((await call('/sync',{workspace,revision,changes:[change('samples','s1',{status:'En preparación'},'update')]},sales)).status,403);
      assert.equal((await write([change('samples','s2',{client_id:'c1',opportunity_id:'op1'})])).status,409);
    });
    await t.test('empaque transaccional e idempotente con aviso',async()=>{
      assert.equal((await write([change('orders','o1',{status:'En producción'},'update')])).status,200);
      assert.equal((await call('/pack',{workspace,revision,orderId:'o1'},sales)).status,403);
      let result=await call('/pack',{workspace,revision,orderId:'o1'},production);
      assert.equal(result.status,200,JSON.stringify(result.data));revision=result.data.revision;
      result=await call('/pack',{workspace,revision,orderId:'o1'},production);
      assert.equal(result.status,200);revision=result.data.revision;
      const state=(await call('/state',null,owner)).data;
      assert.equal(state.rows.orders[0].status,'Empacado');
      assert.equal(state.rows.notifications.filter(row=>row.event==='Empacado').length,1);
      assert.equal((await write([change('orders','o1',{status:'En tránsito'},'update')])).status,400);
      assert.equal((await write([change('orders','o1',{status:'En tránsito',tracking:'TRACK-001'},'update')])).status,200);
    });
    await t.test('sesiones caducadas y cierre de sesión revocan acceso',async()=>{
      assert.equal((await call('/auth/logout',{},other)).status,200);
      assert.equal((await call('/state',null,other)).status,401);
      await admin.query("update auth.sessions set expires_at=now()-interval '1 second'");
      assert.equal((await call('/state',null,owner)).status,401);
    });
    await t.test('fuerza bruta se limita sin confiar en X-Forwarded-For',async()=>{
      await admin.query('delete from auth.login_limits');
      for(let index=0;index<31;index++) {
        const result=await call('/auth/login',{email:'nonexistent@example.test',password:'Invalid-password!' },'',{'X-Forwarded-For':`192.0.2.${index}`});
        assert.equal(result.status,index<30?401:429);
      }
      assert.equal((await call('/state',null,'she_session='+'a'.repeat(64))).status,401);
    });
  } finally {
    await new Promise(resolve=>server.close(resolve));await closeDatabase();await admin.end();
  }
});
