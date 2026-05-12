import { describe, expect, test } from "vitest";
import { ValueFuzzError, fuzzValues, quickCheckValues } from "../src/index.js";

const toggleSource = new URL("./fixtures/Toggle.ts", import.meta.url);

describe("falsy-aware coercion", () => {
  test("default coercion only yields actual booleans", async () => {
    let sawNonBoolean = false;
    await fuzzValues<{ enabled: boolean }>({
      sourcePath: toggleSource,
      typeName: "ToggleInput",
      numRuns: 100,
      seed: 1,
      run({ enabled }) {
        if (typeof enabled !== "boolean") {
          sawNonBoolean = true;
        }
      },
    });
    expect(sawNonBoolean).toBe(false);
  });

  test("falsy-aware mode yields non-boolean falsy / suspicious values", async () => {
    const seen = new Set<string>();
    await fuzzValues<{ enabled: boolean }>({
      sourcePath: toggleSource,
      typeName: "ToggleInput",
      numRuns: 200,
      seed: 1,
      coercion: "falsy-aware",
      run({ enabled }) {
        seen.add(`${typeof enabled}:${String(enabled)}`);
      },
    });
    const variants = [...seen];
    const hasNonBoolean = variants.some((entry) => !entry.startsWith("boolean:"));
    expect(hasNonBoolean).toBe(true);
  });

  test("falsy-aware surfaces a coercion bug", async () => {
    await expect(
      fuzzValues<{ enabled: boolean }>({
        sourcePath: toggleSource,
        typeName: "ToggleInput",
        numRuns: 200,
        seed: 1,
        coercion: "falsy-aware",
        run({ enabled }) {
          // bug: assumes enabled is strictly boolean
          if (enabled !== true && enabled !== false) {
            throw new Error(`non-boolean enabled: ${String(enabled)}`);
          }
        },
      }),
    ).rejects.toBeInstanceOf(ValueFuzzError);
  });

  test("quickCheckValues honors coercion", async () => {
    let sawNonBoolean = false;
    await quickCheckValues<{ enabled: boolean }>({
      sourcePath: toggleSource,
      typeName: "ToggleInput",
      maxCases: 64,
      coercion: "falsy-aware",
      run({ enabled }) {
        if (typeof enabled !== "boolean") {
          sawNonBoolean = true;
        }
      },
    });
    expect(sawNonBoolean).toBe(true);
  });
});
