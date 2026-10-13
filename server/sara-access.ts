import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';
import { headerValue, sameSecret } from './webhook-utils.ts';

// Nginx replaces this header; accept it only with the authenticated gateway.
export function saraClientAddress(request: IncomingMessage): string {
  const address = headerValue(request, 'x-she-client-ip');
  const secret = process.env.SARA_PROXY_SECRET;
  if (process.env.SARA_PUBLIC_ORIGIN && secret && secret.length >= 32 &&
      sameSecret(headerValue(request, 'x-she-proxy-secret'), secret) && isIP(address)) return address;
  return request.socket.remoteAddress || 'local';
}

// Public SARA access requires a private proxy header and exact HTTPS origin.
// sara-api checks the CRM session. Never publish the application port directly.
export function saraAccess(request: IncomingMessage): number | null {
  const host = request.headers.host;
  const configuredOrigin = process.env.SARA_PUBLIC_ORIGIN;
  let expectedOrigin: string;
  if (configuredOrigin) {
    let origin: URL;
    try { origin = new URL(configuredOrigin); } catch { return 503; }
    if (origin.protocol !== 'https:' || origin.origin !== configuredOrigin || origin.username || origin.password) return 503;
    const secret = process.env.SARA_PROXY_SECRET;
    if (!secret || secret.length < 32) return 503;
    if (host !== origin.host || !sameSecret(headerValue(request, 'x-she-proxy-secret'), secret)) return 403;
    expectedOrigin = origin.origin;
  } else {
    if (!host || !/^(127\.0\.0\.1|localhost):\d+$/.test(host) || !['127.0.0.1','::1','::ffff:127.0.0.1'].includes(request.socket.remoteAddress || '')) return 403;
    expectedOrigin = `http://${host}`;
  }
  if (request.headers['sec-fetch-site'] === 'cross-site' || (request.headers.origin && request.headers.origin !== expectedOrigin)) return 403;
  if (request.method === 'POST' && request.headers.origin !== expectedOrigin) return 403;
  return null;
}
