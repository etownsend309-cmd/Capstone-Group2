import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
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
