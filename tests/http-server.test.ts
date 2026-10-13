import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createAppServer } from '../server/http-server.ts';

test('el servidor de producción usa las mismas rutas TypeScript y sirve el frontend', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'she-production-'));
  const html = '<!doctype html><html><body>CRM de prueba</body></html>';
  await writeFile(join(directory, 'index.html'), html);
  await writeFile(join(directory, 'app.js'), 'console.log("CRM");');
  const server = await createAppServer(directory);
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const page = await fetch(base);
    assert.equal(page.status, 200);
    assert.equal(await page.text(), html);
    assert.ok(page.headers.get('content-security-policy'));
    const asset = await fetch(`${base}/app.js`);
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('content-type') || '', /text\/javascript/);
    const relay = await fetch(`${base}/api/whatsapp-relay`);
    assert.equal(relay.status, 200);
    assert.deepEqual(await relay.json(), { ok: true, service: 'she-whatsapp-relay' });
    const missing = await fetch(`${base}/api/unknown`);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { ok: false, error: 'not_found' });
    const session = await fetch(`${base}/api/crm/session`);
    assert.equal(session.status, 200);
    assert.deepEqual(await session.json(), { context: null });
    const sara = await fetch(`${base}/api/sara/state`, { headers: { 'sec-fetch-site': 'cross-site' } });
    assert.equal(sara.status, 403);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    // The directory was created by this test under the OS temporary directory.
    await rm(directory, { recursive: true, force: true });
  }
});
