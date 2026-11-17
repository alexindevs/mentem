import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Native SQLite connections and temp files: keep workers few and light.
    pool: "forks",
    maxWorkers: 2,
  },
});
