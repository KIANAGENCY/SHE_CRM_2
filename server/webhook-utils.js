import { timingSafeEqual } from "node:crypto";

export const MAX_BODY_BYTES = 1024 * 1024;

export function sameSecret(supplied, expected) {
  if (typeof supplied !== "string" || typeof expected !== "string") return false;
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function headerValue(request, name) {
  const value = request.headers?.[name];
  return Array.isArray(value) ? value[0] : value || "";
}

export function sendJson(response, status, body) {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.end(JSON.stringify(body));
}

export async function readRawBody(request) {
  const chunks = [];
  let size = 0;
  // Keep IncomingMessage alive so oversized bodies receive a JSON 413 response.
  const stream = request.iterator({ destroyOnReturn: false });
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_BODY_BYTES) {
      request.resume();
      const error = new Error("payload_too_large");
      error.status = 413;
      throw error;
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

export function isWhatsAppEvent(body) {
  return body?.object === "whatsapp_business_account" &&
    Array.isArray(body.entry) && body.entry.length > 0 &&
    body.entry.every((entry) => entry && typeof entry === "object" &&
      !Array.isArray(entry) && typeof entry.id === "string" && entry.id.length > 0);
}

export function webhookUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password
      ? url.href : null;
  } catch {
    return null;
  }
}

export async function forwardEvent(response, url, body, headers) {
  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
    });
    await upstream.body?.cancel();
    if (!upstream.ok) {
      return sendJson(response, 502, {
        ok: false, error: "n8n_rejected_event", upstreamStatus: upstream.status,
      });
    }
    return sendJson(response, 202, { ok: true, accepted: true });
  } catch {
    return sendJson(response, 502, { ok: false, error: "n8n_unavailable" });
  }
}
