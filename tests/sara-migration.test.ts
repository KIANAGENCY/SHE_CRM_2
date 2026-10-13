import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encryptPayload, decryptPayload, restoreBackup } from '../scripts/sara-migration.mjs';

const payload={version:1,createdAt:'2026-10-12T00:00:00Z',files:['.local/sara-crm.sqlite','.local/sara-connection.json','.env.local'].map(path=>({path,data:Buffer.from(`contenido:${path}`).toString('base64')}))};
test('el respaldo cifrado restaura todos los bytes y rechaza otra llave o un archivo alterado',()=>{
  const key=randomBytes(32),envelope=encryptPayload(payload,key);
  assert.deepEqual(decryptPayload(envelope,key),payload);
  assert.equal(envelope.includes('contenido:'),false);
  assert.throws(()=>decryptPayload(envelope,randomBytes(32)));
  const changed=JSON.parse(envelope);const bytes=Buffer.from(changed.data,'base64');bytes[0]^=1;changed.data=bytes.toString('base64');
  assert.throws(()=>decryptPayload(JSON.stringify(changed),key));
});
test('la restauración rechaza rutas ajenas al respaldo y exige todos los archivos',()=>{
  const key=randomBytes(32);
  assert.throws(()=>decryptPayload(encryptPayload({...payload,files:[{path:'../escape',data:'YQ=='}]},key),key));
});
test('restauración en destino nuevo sin sobrescribir configuración',async()=>{
  const prefix=join(tmpdir(),'sara-restore-test-'),directory=mkdtempSync(prefix);
  try{
    const {writeFile}=await import('node:fs/promises');const keyFile=join(directory,'llave.key'),input=join(directory,'respaldo.enc'),destination=join(directory,'crm');const key=randomBytes(32);
    await writeFile(keyFile,key);await writeFile(input,encryptPayload(payload,key));
    await restoreBackup({input,keyFile,destination});
    assert.equal(readFileSync(join(destination,'.env.local'),'utf8'),'contenido:.env.local');
    await assert.rejects(()=>restoreBackup({input,keyFile,destination}),/ya contiene/);
    await writeFile(keyFile,randomBytes(32));const bad=join(directory,'incorrecto');
    await assert.rejects(()=>restoreBackup({input,keyFile,destination:bad}));assert.equal(existsSync(bad),false);
  }finally{assert.ok(directory.startsWith(prefix));rmSync(directory,{recursive:true,force:true});}
});
