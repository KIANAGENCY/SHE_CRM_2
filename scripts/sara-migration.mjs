import { DatabaseSync, backup } from 'node:sqlite';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, access, unlink } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';

const allowed = ['.local/sara-crm.sqlite','.local/sara-connection.json','.env.local'];
const aad = Buffer.from('SHECRM-MIGRATION-V1');
async function exists(path) { try { await access(path); return true; } catch { return false; } }

export function encryptPayload(payload,key) {
  if (key.length!==32) throw new Error('La llave debe tener 32 bytes.');
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(aad);
  const ciphertext=Buffer.concat([cipher.update(gzipSync(Buffer.from(JSON.stringify(payload)))),cipher.final()]);
  return JSON.stringify({format:'SHECRM-MIGRATION',version:1,cipher:'aes-256-gcm',iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:ciphertext.toString('base64')});
}
export function decryptPayload(envelope,key) {
  const item=JSON.parse(envelope);
  if(item.format!=='SHECRM-MIGRATION'||item.version!==1||item.cipher!=='aes-256-gcm'||key.length!==32)throw new Error('Respaldo o llave inválidos.');
  const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(item.iv,'base64'));
  decipher.setAAD(aad);decipher.setAuthTag(Buffer.from(item.tag,'base64'));
  const compressed=Buffer.concat([decipher.update(Buffer.from(item.data,'base64')),decipher.final()]);
  const payload=JSON.parse(gunzipSync(compressed,{maxOutputLength:100*1024*1024}).toString('utf8'));
  if(payload.version!==1||!Array.isArray(payload.files)||payload.files.length!==allowed.length||new Set(payload.files.map(file=>file.path)).size!==allowed.length||payload.files.some(file=>!allowed.includes(file.path)||typeof file.data!=='string'))throw new Error('Contenido del respaldo inválido.');
  return payload;
}

export async function createBackup({root=process.cwd(),output,keyFile}) {
  root=resolve(root);output=resolve(output);keyFile=resolve(keyFile);
  if(await exists(output)||await exists(keyFile))throw new Error('El respaldo o la llave ya existen. Usa nombres nuevos.');
  await mkdir(join(root,'.local'),{recursive:true});
  const temporary=join(root,'.local',`migration-snapshot-${randomUUID()}.sqlite`);
  let db;
  try {
    db=new DatabaseSync(join(root,'.local/sara-crm.sqlite'),{readOnly:true});
    await backup(db,temporary);db.close();db=null;
    const files=[];
    for(const path of allowed) files.push({path,data:(await readFile(path.endsWith('sara-crm.sqlite')?temporary:join(root,path))).toString('base64')});
    const key=randomBytes(32),payload={version:1,createdAt:new Date().toISOString(),files};
    const envelope=encryptPayload(payload,key);
    // Verify authentication and all bytes before writing a portable backup.
    const restored=decryptPayload(envelope,key);
    if(JSON.stringify(restored.files)!==JSON.stringify(files))throw new Error('La verificación del respaldo falló.');
    await mkdir(dirname(output),{recursive:true});await mkdir(dirname(keyFile),{recursive:true});
    await writeFile(keyFile,key,{flag:'wx',mode:0o600});
    await writeFile(output,envelope+'\n',{flag:'wx',mode:0o600});
    return {createdAt:payload.createdAt,files:files.length};
  } finally { db?.close();if(await exists(temporary))await unlink(temporary); }
}

export async function restoreBackup({input,keyFile,destination=process.cwd()}) {
  const key=await readFile(resolve(keyFile));
  const payload=decryptPayload(await readFile(resolve(input),'utf8'),key);
  destination=resolve(destination);
  const targets=payload.files.map(file=>({path:resolve(destination,file.path),data:Buffer.from(file.data,'base64')}));
  for(const target of targets) if(await exists(target.path))throw new Error('El destino ya contiene datos o configuración. Restaura en una instalación nueva.');
  if(await exists(join(destination,'.local','sara-crm.sqlite-wal'))||await exists(join(destination,'.local','sara-crm.sqlite-shm')))throw new Error('Hay archivos activos de SQLite en el destino.');
  for(const target of targets){await mkdir(dirname(target.path),{recursive:true,mode:0o700});await writeFile(target.path,target.data,{flag:'wx',mode:0o600});}
  return {createdAt:payload.createdAt,files:targets.length};
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const [action,file,...args]=process.argv.slice(2);
  const keyIndex=args.indexOf('--key-file'),keyFile=keyIndex>=0?args[keyIndex+1]:null;
  const targetIndex=args.indexOf('--destination'),destination=targetIndex>=0?args[targetIndex+1]:process.cwd();
  if(!['backup','restore'].includes(action)||!file||!keyFile)throw new Error('Uso: node scripts/sara-migration.mjs backup|restore ARCHIVO --key-file LLAVE [--destination CARPETA]');
  const result=action==='backup'?await createBackup({output:file,keyFile}):await restoreBackup({input:file,keyFile,destination});
  console.log(`${action==='backup'?'Respaldo cifrado verificado':'Respaldo restaurado'}: ${result.files} archivos, corte ${result.createdAt}.`);
}
