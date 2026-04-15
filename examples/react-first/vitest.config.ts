import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { defineConfig } from "vitest/config";

const require = createRequire(import.meta.url);

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^props-fuzzing$/,
        replacement: fileURLToPath(new URL("../../src/index.ts", import.meta.url)),
      },
      {
        find: /^props-fuzzing\/svelte$/,
        replacement: fileURLToPath(new URL("../../src/svelte.ts", import.meta.url)),
      },
      {
        find: /^props-fuzzing\/vue$/,
        replacement: fileURLToPath(new URL("../../src/vue.ts", import.meta.url)),
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
    environment: "node",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
  },
});
