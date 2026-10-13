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
  const laravel = (process.env.VITE_API_BACKEND ?? environment.VITE_API_BACKEND) === 'laravel';
  const proxy = laravel ? { '/api': { target: environment.LARAVEL_API_URL || 'http://127.0.0.1:8000', changeOrigin: false } } : undefined;
  for (const key of serverKeys) {
    if (environment[key] !== undefined) process.env[key] = environment[key];
  }
  return {
    server: { proxy, fs: { strict: true, deny: [".env", ".env.*", "**/.git/**", "**/.local/**", "**/*.log", "**/backend/**"] } },
    preview: { proxy },
    plugins: [
      react(),
      {
        name: "she-local-api",
        configureServer(server) { if (!laravel) server.middlewares.use(apiMiddleware); },
        configurePreviewServer(server) { if (!laravel) server.middlewares.use(apiMiddleware); },
      },
    ],
  };
});
