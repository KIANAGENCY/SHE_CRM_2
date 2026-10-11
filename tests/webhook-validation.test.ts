import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { Readable } from "node:stream";
import { afterEach, beforeEach, test } from "node:test";
import meta from "../api/meta-whatsapp-webhook.ts";
import relay from "../api/whatsapp-relay.ts";

const keys = ["N8N_WHATSAPP_WEBHOOK_URL", "WHATSAPP_RELAY_SECRET",
  "META_WHATSAPP_VERIFY_TOKEN", "META_WHATSAPP_APP_SECRET"];
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
const originalFetch = globalThis.fetch;
let forwarded;

beforeEach(() => {
  process.env.N8N_WHATSAPP_WEBHOOK_URL = "https://example.test/webhook";
  process.env.WHATSAPP_RELAY_SECRET = "relay-secret";
  process.env.META_WHATSAPP_VERIFY_TOKEN = "verify-token";
  process.env.META_WHATSAPP_APP_SECRET = "app-secret";
  forwarded = [];
  globalThis.fetch = async (...args) => {
    forwarded.push(args);
    return { ok: true, status: 200 };
  };
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of keys) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

function request(body = "", { method = "POST", url = "/", headers = {} } = {}) {
  const req = Readable.from([Buffer.from(body)]);
  return Object.assign(req, { method, url, headers });
}
function response() {
  return {
    headers: {}, statusCode: 200,
    setHeader(name, value) { this.headers[name] = value; },
    end(body) { this.text = body; },
  };
}
const payload = '{ "object": "whatsapp_business_account", "entry": [{ "id": "123" }], "text": "México" }';
const signature = (body) => `sha256=${createHmac("sha256", "app-secret").update(body).digest("hex")}`;

test("Meta devuelve exactamente el challenge y rechaza token incorrecto o challenge ausente", async () => {
  for (const [url, status, text] of [
    ["/?hub.mode=subscribe&hub.verify_token=verify-token&hub.challenge=0", 200, "0"],
    ["/?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=123", 403],
    ["/?hub.mode=subscribe&hub.verify_token=verify-token", 400],
    ["/?hub.mode=other&hub.verify_token=verify-token&hub.challenge=123", 400],
  ]) {
    const res = response();
    await meta(request("", { method: "GET", url }), res);
    assert.equal(res.statusCode, status);
    if (text) assert.equal(res.text, text);
  }
  assert.equal(forwarded.length, 0);
});

test("Meta verifica los bytes originales antes de reenviar el evento", async () => {
  const res = response();
  const req = request(payload, { headers: { "x-hub-signature-256": signature(payload) } });
  // Reading Vercel's lazy JSON getter would consume/reformat the signed body.
  Object.defineProperty(req, "body", { get() { throw new Error("body helper was accessed"); } });
  await meta(req, res);
  assert.equal(res.statusCode, 202);
  assert.equal(forwarded[0][1].body.toString(), payload);
  assert.equal(forwarded[0][1].headers["x-she-source"], "meta-whatsapp");
  assert.equal(forwarded[0][1].redirect, "error");
});

test("Meta rechaza firmas ausentes, malformadas o de un cuerpo alterado sin llamar n8n", async () => {
  for (const value of [undefined, "sha256=bad", "sha256=" + "0".repeat(64), signature(payload + " ")]) {
    const res = response();
    await meta(request(payload, { headers: { "x-hub-signature-256": value } }), res);
    assert.equal(res.statusCode, 401);
  }
  assert.equal(forwarded.length, 0);
});

test("los webhooks rechazan JSON malformado y eventos inválidos", async () => {
  for (const handler of [meta, relay]) {
    for (const body of ["{broken", "null", "[]", '{"object":"whatsapp_business_account","entry":[]}',
      '{"object":"whatsapp_business_account","entry":[null]}']) {
      const res = response();
      await handler(request(body, { headers: {
        "x-hub-signature-256": signature(body), "x-she-relay-secret": "relay-secret",
      } }), res);
      assert.equal(res.statusCode, 400);
    }
  }
  assert.equal(forwarded.length, 0);
});

test("los webhooks limitan el tamaño de entrada", async () => {
  const body = "x".repeat(1024 * 1024 + 1);
  for (const handler of [meta, relay]) {
    const res = response();
    await handler(request(body, { headers: {
      "x-hub-signature-256": signature(body), "x-she-relay-secret": "relay-secret",
    } }), res);
    assert.equal(res.statusCode, 413);
  }
  assert.equal(forwarded.length, 0);
});

test("configuración incompleta o URL inválida no reenvía eventos", async () => {
  delete process.env.META_WHATSAPP_APP_SECRET;
  let res = response();
  await meta(request(payload), res);
  assert.equal(res.statusCode, 503);
  process.env.N8N_WHATSAPP_WEBHOOK_URL = "file:///tmp/webhook";
  res = response();
  await relay(request(payload, { headers: { "x-she-relay-secret": "relay-secret" } }), res);
  assert.equal(res.statusCode, 503);
  assert.equal(forwarded.length, 0);
});

test("métodos no soportados devuelven 405 con Allow", async () => {
  for (const handler of [meta, relay]) {
    const res = response();
    await handler(request("", { method: "PUT" }), res);
    assert.equal(res.statusCode, 405);
    assert.equal(res.headers.allow, "GET, POST");
  }
});

test("rechazo, timeout y redirección de n8n devuelven 502", async () => {
  for (const handler of [meta, relay]) {
    for (const failure of [async () => ({ ok: false, status: 500 }),
      async () => { throw new DOMException("timeout", "TimeoutError"); },
      async () => { throw new TypeError("redirect"); }]) {
      globalThis.fetch = failure;
      const res = response();
      await handler(request(payload, { headers: {
        "x-hub-signature-256": signature(payload), "x-she-relay-secret": "relay-secret",
      } }), res);
      assert.equal(res.statusCode, 502);
      assert.equal(JSON.parse(res.text).ok, false);
    }
  }
});
