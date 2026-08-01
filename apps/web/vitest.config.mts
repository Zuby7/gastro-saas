import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    // Playwright E2E specs (ticket #7) live under e2e/ and are run via
    // `pnpm test:e2e` (Playwright's own runner), not Vitest.
    exclude: ["**/node_modules/**", "**/e2e/**"],
  },
});
