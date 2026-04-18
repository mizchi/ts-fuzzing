import { fileURLToPath } from "node:url";
import * as z from "zod";
import { describe, expect, test } from "vitest";
import {
  resolveFuzzData,
  sampleBoundaryFuzzData,
  sampleFuzzData,
} from "../src/index.js";

const safeButtonPath = fileURLToPath(new URL("./fixtures/SafeButton.tsx", import.meta.url));

describe("fuzz data core", () => {
  test("resolves TypeScript-backed fuzz data and samples values without a UI renderer", async () => {
    const resolved = resolveFuzzData({
      sourcePath: safeButtonPath,
      exportName: "SafeButton",
    });

    const values: unknown[] = [];
    for await (const value of sampleFuzzData(resolved, {
      numRuns: 3,
      seed: 7,
    })) {
      values.push(value);
    }

    expect(resolved.componentDescriptor.kind).toBe("object");
    expect(values).toHaveLength(3);
    expect(values.every((value) => typeof (value as { label?: unknown }).label === "string")).toBe(true);
  });

  test("lets consumers reshape the input descriptor before generating values", async () => {
    const resolved = resolveFuzzData({
      sourcePath: safeButtonPath,
      exportName: "SafeButton",
    });

    const values: unknown[] = [];
    for await (const value of sampleBoundaryFuzzData(resolved, {
      describeInput: () => ({
        kind: "object",
        properties: [
          {
            key: "provider",
            optional: false,
            value: {
              kind: "object",
              properties: [
                {
                  key: "theme",
                  optional: false,
                  value: { kind: "literal", value: "light" },
                },
              ],
            },
          },
        ],
      }),
      maxCases: 8,
    })) {
      values.push(value);
    }

    expect(values).toEqual([{ provider: { theme: "light" } }]);
  });

  test("resolves schema-backed fuzz data directly for non-UI consumers", async () => {
    const resolved = resolveFuzzData({
      schema: z.object({
        handle: z.string().min(1).transform((value) => value.toUpperCase()),
      }),
    });

    const values: unknown[] = [];
    for await (const value of sampleFuzzData(resolved, {
      numRuns: 4,
      seed: 2,
    })) {
      values.push(value);
    }

    expect(values).toHaveLength(4);
    for (const value of values) {
      expect((value as { handle: string }).handle).toBe((value as { handle: string }).handle.toUpperCase());
    }
  });
});
