import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^ts-fuzzing\/security$/,
        replacement: fileURLToPath(new URL("../../src/security.ts", import.meta.url)),
      },
      {
        find: /^ts-fuzzing$/,
        replacement: fileURLToPath(new URL("../../src/index.ts", import.meta.url)),
      },
    ],
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
