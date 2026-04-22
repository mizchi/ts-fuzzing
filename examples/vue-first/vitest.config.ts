import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

const require = createRequire(import.meta.url);

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: [
      {
        find: /^ts-fuzzing$/,
        replacement: fileURLToPath(new URL("../../src/index.ts", import.meta.url)),
      },
      {
        find: /^ts-fuzzing\/vue$/,
        replacement: fileURLToPath(new URL("../../src/vue.ts", import.meta.url)),
      },
      { find: /^vue$/, replacement: require.resolve("vue") },
    ],
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
