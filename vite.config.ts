import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { localDevApi } from "./scripts/localDevApi.ts";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "local-dev-api",
      configureServer(server) {
        // Before Vite's HTML fallback, and only while this dev server is running.
        server.middlewares.use(localDevApi());
      },
    },
  ],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
  },
  // PDF.js ships large prebuilt bundles; excluding them from dependency
  // pre-bundling keeps the worker resolvable from `new URL(..., import.meta.url)`.
  optimizeDeps: {
    exclude: ["pdfjs-dist"],
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
});
