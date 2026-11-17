import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Native SQLite connections and temp files: keep workers few and light.
    pool: "forks",
    maxWorkers: 2,
    // Shared CI machines have slow disks; a database test can take a few seconds there.
    testTimeout: 30_000,
  },
});
