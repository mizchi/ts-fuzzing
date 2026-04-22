import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

const require = createRequire(import.meta.url);

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: [
      {
        find: /^ts-fuzzing$/,
        replacement: fileURLToPath(new URL("../../src/index.ts", import.meta.url)),
      },
      {
        find: /^ts-fuzzing\/svelte$/,
        replacement: fileURLToPath(new URL("../../src/svelte.ts", import.meta.url)),
      },
      { find: /^svelte\/server$/, replacement: require.resolve("svelte/server") },
      { find: /^svelte$/, replacement: require.resolve("svelte") },
    ],
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
