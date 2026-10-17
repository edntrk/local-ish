import { defineConfig } from "vite";

// /api/* is forwarded to the API server, so the app and API feel like one site.
export default defineConfig({
  server: { port: 5173, proxy: { "/api": "http://localhost:8787" } },
});
