import { crmApi } from './crm-api.js';
import { saraApi } from './sara-api.js';
import { sendJson } from './webhook-utils.js';

export function apiMiddleware(request, response, next) {
  const pathname = new URL(request.url || '/', 'http://localhost').pathname;
  if (pathname !== '/api' && !pathname.startsWith('/api/')) return next();
  const handler = pathname === '/api/sara' || pathname.startsWith('/api/sara/') ? saraApi : crmApi;
  if (handler === crmApi && pathname !== '/api/crm' && !pathname.startsWith('/api/crm/')) {
    return sendJson(response, 404, { ok: false, error: 'not_found' });
  }
  Promise.resolve(handler(request, response)).catch(() => {
    if (!response.headersSent) sendJson(response, 500, { ok: false, error: 'internal_error' });
    else response.end();
  });
}
