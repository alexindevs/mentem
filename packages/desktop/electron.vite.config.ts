import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

export default defineConfig({
  main: {
    resolve: { alias: { "@shared": resolve("src/shared") } },
    build: {
      // The core package is TypeScript source in this workspace, so it is bundled.
      // The native SQLite module can never be bundled.
      externalizeDeps: { exclude: ["@mentem/core"] },
      // The command line is built beside the app, so both run on the same bundled Node.
      rollupOptions: { external: ["better-sqlite3"], input: { index: resolve("src/main/index.ts"), cli: resolve("../cli/src/main.ts") } },
    },
  },
  preload: {
    resolve: { alias: { "@shared": resolve("src/shared") } },
  },
  renderer: {
    resolve: { alias: { "@": resolve("src/renderer/src"), "@shared": resolve("src/shared") } },
    plugins: [react(), tailwindcss()],
  },
});
