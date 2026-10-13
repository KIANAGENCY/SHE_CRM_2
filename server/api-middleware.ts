import type { IncomingMessage, ServerResponse } from "node:http";
import relay from "../api/whatsapp-relay.ts";
import metaWebhook from "../api/meta-whatsapp-webhook.ts";
import { sendJson } from "./webhook-utils.ts";
import { crmApi } from "./crm-api.js";
import { saraApi } from "./sara-api.js";

const routes = new Map([
  ["/api/whatsapp-relay", relay],
  ["/api/meta-whatsapp-webhook", metaWebhook],
]);

export function apiMiddleware(
  request: IncomingMessage,
  response: ServerResponse,
  next: () => void,
) {
  const pathname = new URL(request.url || "/", "http://localhost").pathname;
  if (pathname !== "/api" && !pathname.startsWith("/api/")) return next();
  const handler = pathname === "/api/sara" || pathname.startsWith("/api/sara/")
    ? saraApi
    : pathname === "/api/crm" || pathname.startsWith("/api/crm/")
    ? crmApi
    : routes.get(pathname);
  if (!handler) return sendJson(response, 404, { ok: false, error: "not_found" });
  Promise.resolve(handler(request, response)).catch(() => {
    if (!response.headersSent) sendJson(response, 500, { ok: false, error: "internal_error" });
    else response.end();
  });
}
