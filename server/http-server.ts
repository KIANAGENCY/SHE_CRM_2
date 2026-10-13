import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { apiMiddleware } from './api-middleware.ts';
export async function createAppServer(directory = 'dist') {
  const root = await realpath(resolve(directory));
  const index = await readFile(resolve(root,'index.html'),'utf8');
  const hashes = [...index.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].filter(match => match[1].trim()).map(match => `'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`);
  const connections = ["'self'"];
  if (process.env.VITE_BACKEND !== 'local' && process.env.VITE_SUPABASE_URL) {
    const url = new URL(process.env.VITE_SUPABASE_URL);
    if (url.protocol !== 'https:') throw new Error('Supabase requiere HTTPS.');
    connections.push(url.origin, `wss://${url.host}`);
  }
  const policy = `default-src 'self'; script-src 'self' ${hashes.join(' ')}; script-src-attr 'none'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src ${connections.join(' ')}; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`;
  const types: Record<string, string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
  const server = createServer((req,res) => {
    res.setHeader('Content-Security-Policy',policy);
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','same-origin');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
    if (process.env.COOKIE_SECURE === 'true') res.setHeader('Strict-Transport-Security','max-age=31536000');
    try {
      apiMiddleware(req,res,async()=>{
        try {
          if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
          const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
          const file=resolve(root,`.${pathname==='/'?'/index.html':pathname}`);
          if (!file.startsWith(root+sep)) { res.writeHead(403); return res.end(); }
          const actual = await realpath(file);
          if (!actual.startsWith(root+sep)) { res.writeHead(403); return res.end(); }
          const bytes=await readFile(actual);
          res.setHeader('Content-Type',types[extname(file)]||'application/octet-stream');
          res.setHeader('Cache-Control',pathname.startsWith('/assets/')?'public, max-age=31536000, immutable':'no-cache');
          res.end(req.method==='HEAD'?undefined:bytes);
        } catch { res.writeHead(404); res.end('No encontrado.'); }
      });
    } catch { res.writeHead(400); res.end('Petición inválida.'); }
  });
  server.requestTimeout=15000;
  server.headersTimeout=10000;
  return server;
}
