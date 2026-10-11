import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createServer } from "vite";

test("Vite sirve los módulos y ejecuta las dos API por HTTP", async () => {
  const keys = ["N8N_WHATSAPP_WEBHOOK_URL", "WHATSAPP_RELAY_SECRET",
    "META_WHATSAPP_VERIFY_TOKEN", "META_WHATSAPP_APP_SECRET"];
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const received = [];
  const upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    received.push(Buffer.concat(chunks).toString());
    res.end("accepted");
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  process.env.N8N_WHATSAPP_WEBHOOK_URL = `http://127.0.0.1:${upstream.address().port}/webhook`;
  process.env.WHATSAPP_RELAY_SECRET = "test-relay-secret";
  process.env.META_WHATSAPP_VERIFY_TOKEN = "test-verify-token";
  process.env.META_WHATSAPP_APP_SECRET = "test-app-secret";
  let server;
  try {
    server = await createServer({
      root: fileURLToPath(new URL("../", import.meta.url)),
      server: { host: "127.0.0.1", port: 0 }, logLevel: "silent",
    });
    await server.listen();
    const base = `http://127.0.0.1:${server.httpServer.address().port}`;
    const page = await fetch(base);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /src\/main.tsx/);
    const module = await fetch(`${base}/src/cloud.ts`);
    assert.equal(module.status, 200);
    const source = await module.text();
    assert.doesNotMatch(source, /test-relay-secret|test-app-secret|test-verify-token/);
    assert.match(source, /node_modules\/\.vite\/deps\/@supabase_supabase-js/);
    const health = await fetch(`${base}/api/whatsapp-relay`);
    assert.deepEqual(await health.json(), { ok: true, service: "she-whatsapp-relay" });
    const missing = await fetch(`${base}/api/missing`);
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error, "not_found");
    const verify = await fetch(`${base}/api/meta-whatsapp-webhook?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=42`);
    assert.equal(verify.status, 200);
    assert.equal(await verify.text(), "42");
    const body = '{ "object": "whatsapp_business_account", "entry": [{ "id": "123" }] }';
    for (const [route, headers] of [
      ["whatsapp-relay", { "x-she-relay-secret": "test-relay-secret" }],
      ["meta-whatsapp-webhook", { "x-hub-signature-256": `sha256=${createHmac("sha256", "test-app-secret").update(body).digest("hex")}` }],
    ]) {
      const result = await fetch(`${base}/api/${route}`, {
        method: "POST", headers: { "content-type": "application/json", ...headers }, body,
      });
      assert.equal(result.status, 202);
    }
    assert.deepEqual(received, [body, body]);
    const oversized = await fetch(`${base}/api/whatsapp-relay`, {
      method: "POST", headers: { "x-she-relay-secret": "test-relay-secret" },
      body: "x".repeat(1024 * 1024 + 1),
    });
    assert.equal(oversized.status, 413);
    assert.equal((await oversized.json()).error, "payload_too_large");
  } finally {
    await server?.close();
    await new Promise((resolve) => upstream.close(resolve));
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
});
