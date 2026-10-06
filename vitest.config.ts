import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    // Node by default, because most tests are pure functions and real PDF
    // parsing. The component tests opt into jsdom with a file docblock.
    environment: "node",
    include: ["tests/unit/**/*.test.{ts,tsx}"],
    reporters: ["default"],
  },
});
