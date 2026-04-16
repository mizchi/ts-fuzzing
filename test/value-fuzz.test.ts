import { fileURLToPath } from "node:url";
import * as z from "zod";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  ValueFuzzError,
  fuzzValues,
  fuzzValuesGuided,
  quickCheckValues,
  sampleBoundaryValues,
  sampleValues,
} from "../src/index.js";
import { collectAsync } from "./helpers/collect_async.js";

const safeButtonPath = fileURLToPath(new URL("./fixtures/SafeButton.tsx", import.meta.url));
const fuzzHintsPath = fileURLToPath(new URL("./fixtures/FuzzHints.ts", import.meta.url));
const conditionalTypesPath = fileURLToPath(new URL("./fixtures/ConditionalTypes.ts", import.meta.url));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("generic value fuzzing", () => {
  test("samples values from exported TypeScript types", async () => {
    const values = await collectAsync(sampleValues({
      sourcePath: safeButtonPath,
      typeName: "SafeButtonProps",
      numRuns: 3,
      seed: 7,
    }));

    expect(values).toHaveLength(3);
    expect(values.every((value) => typeof value.label === "string")).toBe(true);
  });

  test("quick-checks generic values against a consumer callback", async () => {
    await expect(
      quickCheckValues({
        schema: z.object({
          count: z.number().int().min(0).max(0).transform((value) => value + 1),
        }),
        maxCases: 4,
        run(value) {
          expect((value as { count: number }).count).toBe(1);
        },
      }),
    ).resolves.toMatchObject({
      checkedCases: 1,
      totalCases: 1,
    });
  });

  test("wraps failing generic runs in ValueFuzzError", async () => {
    await expect(
      fuzzValues({
        sourcePath: safeButtonPath,
        typeName: "SafeButtonProps",
        numRuns: 8,
        seed: 2,
        run(value) {
          if ((value as { variant: string }).variant === "ghost") {
            throw new Error("ghost blocked");
          }
        },
      }),
    ).rejects.toMatchObject({
      name: "ValueFuzzError",
      failingValue: expect.any(Object),
      warnings: [],
    });
  });

  test("supports guided fuzzing for generic consumers", async () => {
    const report = await fuzzValuesGuided({
      schema: z.object({
        label: z.string().min(1),
      }),
      initialCorpusSize: 2,
      maxIterations: 4,
      seed: 1,
      run: () => undefined,
    });

    expect(report.iterations).toBe(4);
    expect(report.corpusSize).toBeGreaterThan(0);
  });

  test("samples generic boundary values through the generic API", async () => {
    const values = await collectAsync(sampleBoundaryValues({
      sourcePath: safeButtonPath,
      typeName: "SafeButtonProps",
      maxCases: 8,
    }));

    expect(values.length).toBeGreaterThan(0);
    expect(values[0]).toBeDefined();
  });

  test("emits runtime warnings for nongeneralizable generics", async () => {
    const emitWarning = vi.spyOn(process, "emitWarning").mockImplementation(() => undefined);
    const genericPath = fileURLToPath(new URL("./fixtures/GenericBox.ts", import.meta.url));

    await collectAsync(sampleValues({
      sourcePath: genericPath,
      typeName: "Box",
      numRuns: 2,
      seed: 1,
    }));

    expect(emitWarning).toHaveBeenCalledWith(
      expect.stringContaining('generic type parameter "T" is unconstrained'),
    );
  });

  test("emits warnings on every invocation instead of suppressing duplicates globally", async () => {
    const emitWarning = vi.spyOn(process, "emitWarning").mockImplementation(() => undefined);
    const genericPath = fileURLToPath(new URL("./fixtures/GenericBox.ts", import.meta.url));

    await collectAsync(sampleValues({
      sourcePath: genericPath,
      typeName: "Box",
      numRuns: 1,
      seed: 1,
    }));
    await collectAsync(sampleValues({
      sourcePath: genericPath,
      typeName: "Box",
      numRuns: 1,
      seed: 2,
    }));

    expect(
      emitWarning.mock.calls.filter(([message]) =>
        String(message).includes('generic type parameter "T" is unconstrained'),
      ),
    ).toHaveLength(2);
  });

  test("keeps seeded iterators deterministic", async () => {
    const first = await collectAsync(sampleValues({
      sourcePath: safeButtonPath,
      typeName: "SafeButtonProps",
      numRuns: 4,
      seed: 19,
    }));
    const second = await collectAsync(sampleValues({
      sourcePath: safeButtonPath,
      typeName: "SafeButtonProps",
      numRuns: 4,
      seed: 19,
    }));

    const snapshot = (values: Array<Record<string, unknown>>) =>
      values.map((value) => ({
        count: value.count,
        hasOnClick: typeof value.onClick === "function",
        label: value.label,
        variant: value.variant,
      }));

    expect(snapshot(second)).toEqual(snapshot(first));
  });

  test("samples values from ts-fuzzing marker hints", async () => {
    const values = await collectAsync(sampleValues({
      sourcePath: fuzzHintsPath,
      typeName: "FuzzHints",
      numRuns: 4,
      seed: 11,
    }));

    expect(values).toHaveLength(4);
    expect(values.every((value) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.id))).toBe(true);
    expect(values.every((value) => /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value.token))).toBe(true);
    expect(values.every((value) => new Date(value.createdAt).toISOString() === value.createdAt)).toBe(true);
    expect(values.every((value) => value.email.includes("@"))).toBe(true);
    expect(values.every((value) => Number.isInteger(value.score) && value.score >= 0 && value.score <= 10)).toBe(true);
    expect(values.every((value) => typeof value.ratio === "number" && value.ratio >= 0 && value.ratio <= 1)).toBe(true);
    expect(values.every((value) => value.title.length >= 2 && value.title.length <= 4)).toBe(true);
    expect(values.every((value) => value.tags.length >= 1 && value.tags.length <= 2)).toBe(true);
  });

  test("samples values from generalized conditional types", async () => {
    const values = await collectAsync(sampleValues({
      sourcePath: conditionalTypesPath,
      typeName: "WrappedGeneric",
      numRuns: 12,
      seed: 13,
    }));

    expect(values.some((value) => "value" in value && typeof value.value === "string")).toBe(true);
    expect(values.some((value) => "items" in value && Array.isArray(value.items))).toBe(true);
  });

  test("accepts describeInput directly when sampling boundary values", async () => {
    const values = await collectAsync(sampleBoundaryValues<{ provider: { theme: "light" } }>({
      sourcePath: safeButtonPath,
      typeName: "SafeButtonProps",
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
      maxCases: 4,
    }));

    expect(values).toEqual([{ provider: { theme: "light" } }]);
  });
});
