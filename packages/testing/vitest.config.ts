import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    // Integration tests hit a real local Supabase/Postgres instance and can
    // take longer than the default unit-test timeout, especially the first
    // connection attempt.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
