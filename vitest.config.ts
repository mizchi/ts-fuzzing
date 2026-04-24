import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

const require = createRequire(import.meta.url);

export default defineConfig({
  plugins: [vue(), svelte()],
  resolve: {
    alias: [
      {
        find: /^ts-fuzzing$/,
        replacement: fileURLToPath(new URL("./src/index.ts", import.meta.url)),
      },
      {
        find: /^ts-fuzzing\/react$/,
        replacement: fileURLToPath(new URL("./src/react.ts", import.meta.url)),
      },
      {
        find: /^ts-fuzzing\/svelte$/,
        replacement: fileURLToPath(new URL("./src/svelte.ts", import.meta.url)),
      },
      {
        find: /^ts-fuzzing\/vue$/,
        replacement: fileURLToPath(new URL("./src/vue.ts", import.meta.url)),
      },
      { find: /^react\/jsx-dev-runtime$/, replacement: require.resolve("react/jsx-dev-runtime") },
      { find: /^react\/jsx-runtime$/, replacement: require.resolve("react/jsx-runtime") },
      { find: /^react-dom\/client$/, replacement: require.resolve("react-dom/client") },
      { find: /^react-dom\/server$/, replacement: require.resolve("react-dom/server") },
      { find: /^react-dom$/, replacement: require.resolve("react-dom") },
      { find: /^react$/, replacement: require.resolve("react") },
    ],
  },
  test: {
    coverage: {
      exclude: ["dist/**", "test/**", "**/*.d.ts"],
      include: ["src/**/*.ts"],
      provider: "v8",
      reporter: ["text", "json-summary"],
      thresholds: {
        branches: 80,
        functions: 90,
        lines: 90,
        statements: 90,
      },
    },
    environment: "node",
    include: [
      "test/**/*.test.ts",
      "test/**/*.test.tsx",
      "examples/**/*.test.ts",
      "examples/**/*.test.tsx",
    ],
    testTimeout: 30000,
  },
});
