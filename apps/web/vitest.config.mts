import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Mirrors tsconfig.json's "@/*" -> "./src/*" path mapping. Needed for
    // action-level tests (ticket #7 fix cycle 1) that import server action
    // modules (e.g. app/login/actions.ts) using that alias -- Vite/Vitest
    // does not read tsconfig `paths` on its own without this.
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    // Playwright E2E specs (ticket #7) live under e2e/ and are run via
    // `pnpm test:e2e` (Playwright's own runner), not Vitest.
    exclude: ["**/node_modules/**", "**/e2e/**"],
  },
});
