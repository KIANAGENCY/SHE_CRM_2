import { createHmac } from "node:crypto";
import {
  forwardEvent, headerValue, isWhatsAppEvent, readRawBody,
  sameSecret, sendJson, webhookUrl,
} from "../server/webhook-utils.ts";

export default async function handler(request, response) {
  if (request.method === "GET") {
    const params = new URL(request.url, "http://localhost").searchParams;
    const verifyToken = process.env.META_WHATSAPP_VERIFY_TOKEN;
    const challenge = params.get("hub.challenge");
    if (params.get("hub.mode") !== "subscribe" || !challenge) {
      return sendJson(response, 400, { ok: false, error: "invalid_verification_request" });
    }
    if (!verifyToken) {
      return sendJson(response, 503, { ok: false, error: "meta_webhook_not_configured" });
    }
    if (!sameSecret(params.get("hub.verify_token"), verifyToken)) {
      return sendJson(response, 403, { ok: false, error: "invalid_verify_token" });
    }
    response.statusCode = 200;
    response.setHeader("content-type", "text/plain; charset=utf-8");
    response.setHeader("cache-control", "no-store");
    return response.end(challenge);
  }
  if (request.method !== "POST") {
    response.setHeader("allow", "GET, POST");
    return sendJson(response, 405, { ok: false, error: "method_not_allowed" });
  }
  const appSecret = process.env.META_WHATSAPP_APP_SECRET;
  const n8nUrl = webhookUrl(process.env.N8N_WHATSAPP_WEBHOOK_URL);
  if (!appSecret || !n8nUrl) {
    return sendJson(response, 503, { ok: false, error: "meta_webhook_not_configured" });
  }
  const signature = headerValue(request, "x-hub-signature-256");
  if (!/^sha256=[a-fA-F0-9]{64}$/.test(signature)) {
    return sendJson(response, 401, { ok: false, error: "invalid_signature" });
  }
  let body;
  try {
    body = await readRawBody(request);
    const expected = `sha256=${createHmac("sha256", appSecret).update(body).digest("hex")}`;
    if (!sameSecret(signature.toLowerCase(), expected)) {
      return sendJson(response, 401, { ok: false, error: "invalid_signature" });
    }
    if (!isWhatsAppEvent(JSON.parse(body.toString("utf8")))) {
      return sendJson(response, 400, { ok: false, error: "invalid_whatsapp_payload" });
    }
  } catch (error) {
    return sendJson(response, error.status || 400, {
      ok: false, error: error.status === 413 ? "payload_too_large" : "invalid_json",
    });
  }
  return forwardEvent(response, n8nUrl, body, { "x-she-source": "meta-whatsapp" });
}
