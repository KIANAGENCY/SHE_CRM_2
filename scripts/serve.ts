// Preserve the previous entry point with Vite's module transforms and API.
import { createServer, preview } from "vite";

const options = { host: "127.0.0.1", port: Number(process.env.PORT || 4173) };
const isPreview = process.argv.includes("--dist");
if (isPreview) {
  const server = await preview({ preview: options });
  server.printUrls();
} else {
  const server = await createServer({ server: options });
  await server.listen();
  server.printUrls();
}
