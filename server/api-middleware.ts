import relay from "../api/whatsapp-relay.ts";
import metaWebhook from "../api/meta-whatsapp-webhook.ts";
import { sendJson } from "./webhook-utils.ts";

const routes = new Map([
  ["/api/whatsapp-relay", relay],
  ["/api/meta-whatsapp-webhook", metaWebhook],
]);

export function apiMiddleware(request, response, next) {
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (pathname !== "/api" && !pathname.startsWith("/api/")) return next();
  const handler = routes.get(pathname);
  if (!handler) return sendJson(response, 404, { ok: false, error: "not_found" });
  Promise.resolve(handler(request, response)).catch(() => {
    if (!response.headersSent) {
      sendJson(response, 500, { ok: false, error: "internal_error" });
    } else {
      response.end();
    }
  });
}
