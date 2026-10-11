import {
  forwardEvent, headerValue, isWhatsAppEvent, readRawBody,
  sameSecret, sendJson, webhookUrl,
} from "../server/webhook-utils.ts";

export default async function handler(request, response) {
  if (request.method === "GET") {
    return sendJson(response, 200, { ok: true, service: "she-whatsapp-relay" });
  }
  if (request.method !== "POST") {
    response.setHeader("allow", "GET, POST");
    return sendJson(response, 405, { ok: false, error: "method_not_allowed" });
  }
  const relaySecret = process.env.WHATSAPP_RELAY_SECRET;
  const n8nUrl = webhookUrl(process.env.N8N_WHATSAPP_WEBHOOK_URL);
  if (!relaySecret || !n8nUrl) {
    return sendJson(response, 503, { ok: false, error: "relay_not_configured" });
  }
  if (!sameSecret(headerValue(request, "x-she-relay-secret"), relaySecret)) {
    return sendJson(response, 401, { ok: false, error: "unauthorized" });
  }
  let body;
  try {
    // Vercel's body helper is lazy; preserve the original bytes from the stream.
    body = await readRawBody(request);
    if (!isWhatsAppEvent(JSON.parse(body.toString("utf8")))) {
      return sendJson(response, 400, { ok: false, error: "invalid_whatsapp_payload" });
    }
  } catch (error) {
    return sendJson(response, error.status || 400, {
      ok: false, error: error.status === 413 ? "payload_too_large" : "invalid_json",
    });
  }
  return forwardEvent(response, n8nUrl, body, { "x-she-relay-secret": relaySecret });
}
