import { describe, expect, test } from "vitest";
import { ValueFuzzError, fuzzValues } from "../src/index.js";

const sourcePath = new URL("./fixtures/Nullable.ts", import.meta.url);

type Input = {
  name: string;
  tag?: string;
  count: number | null;
  items: string[];
};

const collectSample = async (
  options: { coercion?: never; nullInjection?: "respect-type" | "never" | "aggressive"; numRuns?: number; seed?: number },
) => {
  const samples: unknown[] = [];
  try {
    await fuzzValues<Input>({
      sourcePath,
      typeName: "NullableInput",
      numRuns: options.numRuns ?? 100,
      seed: options.seed ?? 1,
      nullInjection: options.nullInjection,
      run(value) {
        samples.push(value);
      },
    });
  } catch {
    /* aggressive mode may throw inside the test; that's OK for this collector */
  }
  return samples as Array<Record<string, unknown> | null | undefined>;
};

describe("null injection control", () => {
  test("default (respect-type) injects null only on count, never on name", async () => {
    const samples = await collectSample({});
    const names = samples.map((sample) => sample?.name);
    expect(names.every((name) => typeof name === "string")).toBe(true);
    expect(samples.some((sample) => sample?.count === null)).toBe(true);
  });

  test("never mode suppresses null/undefined everywhere", async () => {
    const samples = await collectSample({ nullInjection: "never", numRuns: 100 });
    expect(samples.length).toBe(100);
    for (const sample of samples) {
      expect(sample).toBeTruthy();
      expect((sample as Record<string, unknown>)?.count).not.toBeNull();
      expect((sample as Record<string, unknown>)?.count).not.toBeUndefined();
      expect((sample as Record<string, unknown>)?.tag).not.toBeNull();
    }
  });

  test("aggressive mode injects null/undefined beyond the type", async () => {
    const samples = await collectSample({ nullInjection: "aggressive", numRuns: 200 });
    const sawNullOrUndefinedRoot = samples.some(
      (sample) => sample === null || sample === undefined,
    );
    const sawNullNameOrItems = samples.some(
      (sample) =>
        sample !== null &&
        sample !== undefined &&
        ((sample as Record<string, unknown>).name === null ||
          (sample as Record<string, unknown>).name === undefined ||
          (sample as Record<string, unknown>).items === null),
    );
    expect(sawNullOrUndefinedRoot || sawNullNameOrItems).toBe(true);
  });

  test("aggressive mode surfaces defensive-coding gaps", async () => {
    await expect(
      fuzzValues<Input>({
        sourcePath,
        typeName: "NullableInput",
        numRuns: 100,
        seed: 1,
        nullInjection: "aggressive",
        run(value) {
          // bug: assumes value.items is defined and an array
          void value.items.map((entry) => entry);
        },
      }),
    ).rejects.toBeInstanceOf(ValueFuzzError);
  });
});
