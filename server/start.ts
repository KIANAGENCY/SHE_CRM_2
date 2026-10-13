import { loadEnv } from 'vite';
import { closeDatabase } from './database.ts';
import { createAppServer } from './http-server.ts';
import { closeSaraResources } from './sara-api.ts';
const env=loadEnv('production',process.cwd(),'');
for (const [key,value] of Object.entries(env)) if (process.env[key]===undefined) process.env[key]=value;
const server=await createAppServer();
server.listen(Number(process.env.PORT||3000),process.env.HOST||'127.0.0.1',()=>console.log(`CRM disponible en http://${process.env.HOST||'127.0.0.1'}:${process.env.PORT||3000}`));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>server.close(async()=>{ closeSaraResources(); await closeDatabase(); process.exit(0); }));
