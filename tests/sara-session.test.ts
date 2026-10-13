import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { hashPassword } from '../server/auth.ts';
import { closeSaraResources, saraApi } from '../server/sara-api.ts';
import { openSaraSessions } from '../server/sara-session.ts';

test('el login SARA protege las API, usa cookies seguras y revoca el acceso al salir', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'she-session-'));
  const keys = ['SARA_PUBLIC_ORIGIN','SARA_PROXY_SECRET','CRM_LOGIN_USER','CRM_LOGIN_PASSWORD_HASH','SARA_AUTH_DATABASE'];
  const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const password = 'Native-CRM-test-password!';
  const origin = 'https://crm.hotelexpert.mx';
  const secret = 'private-proxy-secret-for-the-session-tests';
  const path = join(directory,'auth.sqlite');
  let server: ReturnType<typeof createServer>;
  try {
    process.env.SARA_PUBLIC_ORIGIN = origin;
    process.env.SARA_PROXY_SECRET = secret;
    process.env.CRM_LOGIN_USER = 'direccion';
    process.env.CRM_LOGIN_PASSWORD_HASH = await hashPassword(password);
    process.env.SARA_AUTH_DATABASE = path;
    server = createServer(saraApi);
    await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const call = async (route: string, body?: unknown, cookie = '', overrides = {}) => {
      return await new Promise<{status:number;body:any;cookie:string | null}>((resolve,reject) => {
        const request = httpRequest(`${base}/api/sara${route}`, {
          method:body === undefined ? 'GET' : 'POST',
          headers:{Host:'crm.hotelexpert.mx','x-she-proxy-secret':secret,Origin:origin,'Content-Type':'application/json',Cookie:cookie,...overrides},
        }, response => {
          const chunks: Buffer[]=[];
          response.on('data',chunk=>chunks.push(Buffer.from(chunk)));
          response.on('end',()=>resolve({status:response.statusCode,body:JSON.parse(Buffer.concat(chunks).toString('utf8')),cookie:response.headers['set-cookie']?.[0] || null}));
        });
        request.on('error',reject);
        request.end(body === undefined ? undefined : JSON.stringify(body));
      });
    };
    assert.deepEqual((await call('/session')).body,{context:null});
    assert.equal((await call('/state')).status,401);
    assert.equal((await call('/auth/login',{username:'direccion',password:'incorrect-password'})).status,401);
    assert.equal((await call('/auth/login',{username:'wrong-user',password})).status,401);
    assert.equal((await call('/auth/login',[])).status,400);
    assert.equal((await call('/auth/login',{username:'direccion',password},'',{Origin:'https://attacker.test'})).status,403);
    const login = await call('/auth/login',{username:'direccion',password});
    assert.equal(login.status,200);
    assert.match(login.cookie,/HttpOnly/);assert.match(login.cookie,/Secure/);assert.match(login.cookie,/SameSite=Strict/);
    const cookie = login.cookie.split(';')[0];
    const token = cookie.split('=')[1];
    const session = await call('/session',undefined,cookie);
    assert.equal(session.body.context.user.email,'direccion');
    assert.equal(session.body.context.role,'owner');
    const db = new DatabaseSync(path);
    try {
      const row = db.prepare('SELECT token_hash FROM sessions').get();
      assert.notEqual(row.token_hash,token);
      assert.equal(String(row.token_hash).length,64);
    } finally { db.close(); }
    closeSaraResources();
    assert.equal((await call('/session',undefined,cookie)).body.context.user.email,'direccion');
    const logout = await call('/auth/logout',{},cookie);
    assert.equal(logout.status,200);assert.match(logout.cookie,/Max-Age=0/);
    assert.equal((await call('/state',undefined,cookie)).status,401);
    assert.deepEqual((await call('/session',undefined,cookie)).body,{context:null});
    const second = await call('/auth/login',{username:'direccion',password});
    const secondCookie = second.cookie.split(';')[0];
    const expiryDb = new DatabaseSync(path);
    expiryDb.exec('UPDATE sessions SET expires_at=0');expiryDb.close();
    assert.equal((await call('/state',undefined,secondCookie)).status,401);
    const limiter = openSaraSessions(join(directory,'limits.sqlite'));
    try {
      for(let index=0;index<30;index++)await assert.rejects(limiter.login('direccion','bad-password','test-ip'),{status:401});
      await assert.rejects(limiter.login('direccion',password,'test-ip'),{status:429});
    } finally { limiter.close(); }
  } finally {
    if(server) {server.closeAllConnections();await new Promise<void>(resolve => server.close(()=>resolve()));}
    closeSaraResources();
    for(const key of keys)if(original[key]===undefined)delete process.env[key];else process.env[key]=original[key];
    const absolute = resolve(directory);
    assert.ok(absolute.startsWith(resolve(tmpdir())+sep));
    await rm(absolute,{recursive:true,force:true});
  }
});
