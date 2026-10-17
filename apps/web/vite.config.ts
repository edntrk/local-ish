import { defineConfig } from "vite";

// /api/* is forwarded to the API server, so the app and API feel like one site.
// appType "spa": /trip/<id> and /join/<code> are pages inside index.html, so Vite answers them with index.html.
// When we deploy, the web server needs the same rule: any path that isn't /api/* or a real file serves index.html.
export default defineConfig({
  appType: "spa",
  server: { port: 5173, proxy: { "/api": "http://localhost:8787" } },
});
