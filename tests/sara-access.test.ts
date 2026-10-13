import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import test from 'node:test';
import { saraAccess, saraClientAddress } from '../server/sara-access.ts';

test('SARA conserva el acceso local y exige proxy autenticado y origen exacto en HTTPS', () => {
  const originalOrigin = process.env.SARA_PUBLIC_ORIGIN;
  const originalSecret = process.env.SARA_PROXY_SECRET;
  const secret = 'test-gateway-secret-with-at-least-32-characters';
  const request = (headers: IncomingMessage['headers'], method = 'GET', address = '172.18.0.2') => ({
    headers, method, socket: { remoteAddress: address },
  } as IncomingMessage);
  try {
    delete process.env.SARA_PUBLIC_ORIGIN;
    delete process.env.SARA_PROXY_SECRET;
    assert.equal(saraAccess(request({ host: 'localhost:3000' }, 'GET', '127.0.0.1')), null);
    assert.equal(saraAccess(request({ host: 'crm.hotelexpert.mx' })), 403);
    assert.equal(saraClientAddress(request({ 'x-she-client-ip':'203.0.113.7' })), '172.18.0.2');
    process.env.SARA_PUBLIC_ORIGIN = 'https://crm.hotelexpert.mx';
    assert.equal(saraAccess(request({ host: 'crm.hotelexpert.mx' })), 503);
    process.env.SARA_PROXY_SECRET = secret;
    const headers = { host: 'crm.hotelexpert.mx', 'x-she-proxy-secret': secret };
    assert.equal(saraClientAddress(request({ ...headers, 'x-she-client-ip':'203.0.113.7' })), '203.0.113.7');
    assert.equal(saraClientAddress(request({ ...headers, 'x-she-client-ip':'2001:db8::7' })), '2001:db8::7');
    assert.equal(saraClientAddress(request({ ...headers, 'x-she-client-ip':'203.0.113.7, 203.0.113.8' })), '172.18.0.2');
    assert.equal(saraClientAddress(request({ ...headers, 'x-she-client-ip':'203.0.113.7', 'x-she-proxy-secret':'invalid' })), '172.18.0.2');
    assert.equal(saraAccess(request({ host: 'crm.hotelexpert.mx' })), 403);
    assert.equal(saraAccess(request({ ...headers, 'x-she-proxy-secret': 'invalid' })), 403);
    assert.equal(saraAccess(request(headers)), null);
    assert.equal(saraAccess(request(headers, 'POST')), 403);
    assert.equal(saraAccess(request({ ...headers, origin: 'https://crm.hotelexpert.mx' }, 'POST')), null);
    assert.equal(saraAccess(request({ ...headers, origin: 'https://attacker.test' }, 'POST')), 403);
    assert.equal(saraAccess(request({ ...headers, 'sec-fetch-site': 'cross-site' })), 403);
    assert.equal(saraAccess(request({ ...headers, host: 'attacker.test' })), 403);
    process.env.SARA_PUBLIC_ORIGIN = 'http://crm.hotelexpert.mx';
    assert.equal(saraAccess(request(headers)), 503);
  } finally {
    if (originalOrigin === undefined) delete process.env.SARA_PUBLIC_ORIGIN; else process.env.SARA_PUBLIC_ORIGIN = originalOrigin;
    if (originalSecret === undefined) delete process.env.SARA_PROXY_SECRET; else process.env.SARA_PROXY_SECRET = originalSecret;
  }
});
