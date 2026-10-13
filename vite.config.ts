import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { apiMiddleware } from "./server/api-middleware.ts";

const serverKeys = [
  "N8N_WHATSAPP_WEBHOOK_URL", "WHATSAPP_RELAY_SECRET",
  "META_WHATSAPP_VERIFY_TOKEN", "META_WHATSAPP_APP_SECRET",
  "VITE_BACKEND", "DATABASE_URL", "DATABASE_ADMIN_URL", "PG_PORT",
  "ALLOW_REGISTRATION", "COOKIE_SECURE", "APP_ORIGIN",
];

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), "");
  for (const key of serverKeys) {
    if (environment[key] !== undefined) process.env[key] = environment[key];
  }
  return {
    server: { fs: { strict: true, deny: [".env", ".env.*", "**/.git/**", "**/.local/**", "**/*.log"] } },
    plugins: [
      react(),
      {
        name: "she-local-api",
        configureServer(server) { server.middlewares.use(apiMiddleware); },
        configurePreviewServer(server) { server.middlewares.use(apiMiddleware); },
      },
    ],
  };
});
