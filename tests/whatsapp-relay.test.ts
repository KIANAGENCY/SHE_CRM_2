import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { Readable } from "node:stream";

import handler from "../api/whatsapp-relay.ts";

const originalFetch = globalThis.fetch;
const originalUrl = process.env.N8N_WHATSAPP_WEBHOOK_URL;
const originalSecret = process.env.WHATSAPP_RELAY_SECRET;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalUrl === undefined) delete process.env.N8N_WHATSAPP_WEBHOOK_URL;
  else process.env.N8N_WHATSAPP_WEBHOOK_URL = originalUrl;
  if (originalSecret === undefined) delete process.env.WHATSAPP_RELAY_SECRET;
  else process.env.WHATSAPP_RELAY_SECRET = originalSecret;
});

function response() {
  return {
    headers: {},
    statusCode: 200,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(value) {
      this.statusCode = value;
      return this;
    },
    end(value) {
      this.body = JSON.parse(value);
      return this;
    },
  };
}

test("health check does not require secrets", async () => {
  const res = response();
  await handler({ method: "GET", headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
});

test("rejects a request with no relay secret", async () => {
  process.env.N8N_WHATSAPP_WEBHOOK_URL = "https://example.test/webhook";
  process.env.WHATSAPP_RELAY_SECRET = "expected";
  const res = response();
  await handler({ method: "POST", headers: {}, body: {} }, res);
  assert.equal(res.statusCode, 401);
});

test("forwards the unchanged Meta payload to n8n", async () => {
  process.env.N8N_WHATSAPP_WEBHOOK_URL = "https://example.test/webhook";
  process.env.WHATSAPP_RELAY_SECRET = "expected";
  const payload = { object: "whatsapp_business_account", entry: [{ id: "1" }] };
  let forwarded;
  globalThis.fetch = async (url, options) => {
    forwarded = { url, options };
    return { ok: true, status: 200 };
  };

  const res = response();
  const request = Readable.from([Buffer.from(JSON.stringify(payload))]);
  request.method = "POST";
  request.headers = { "x-she-relay-secret": "expected" };
  await handler(
    request,
    res,
  );

  assert.equal(res.statusCode, 202);
  assert.equal(forwarded.url, "https://example.test/webhook");
  assert.deepEqual(JSON.parse(forwarded.options.body.toString()), payload);
  assert.equal(forwarded.options.headers["x-she-relay-secret"], "expected");
});
