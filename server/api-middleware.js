import { crmApi } from './crm-api.js';
import { sendJson } from './webhook-utils.js';

export function apiMiddleware(request, response, next) {
  const pathname = new URL(request.url || '/', 'http://localhost').pathname;
  if (pathname !== '/api' && !pathname.startsWith('/api/')) return next();
  if (pathname !== '/api/crm' && !pathname.startsWith('/api/crm/')) {
    return sendJson(response, 404, { ok: false, error: 'not_found' });
  }
  Promise.resolve(crmApi(request, response)).catch(() => {
    if (!response.headersSent) sendJson(response, 500, { ok: false, error: 'internal_error' });
    else response.end();
  });
}
