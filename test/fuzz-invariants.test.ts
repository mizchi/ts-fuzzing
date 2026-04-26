import { describe, expect, test } from "vitest";
import * as z from "zod";
import {
  ValueFuzzError,
  fuzzAssociative,
  fuzzCommutative,
  fuzzMonotonic,
} from "../src/index.js";

const numberSchema = z.object({ n: z.number().int().min(-8).max(8) });

describe("fuzzCommutative", () => {
  test("resolves for a commutative operation", async () => {
    await expect(
      fuzzCommutative<z.infer<typeof numberSchema>, number>({
        schema: numberSchema,
        numRuns: 48,
        seed: 1,
        operation: (a, b) => a.n + b.n,
      }),
    ).resolves.toBeUndefined();
  });

  test("rejects when the operation is not commutative", async () => {
    await expect(
      fuzzCommutative<z.infer<typeof numberSchema>, number>({
        schema: numberSchema,
        numRuns: 48,
        seed: 1,
        operation: (a, b) => a.n - b.n,
      }),
    ).rejects.toBeInstanceOf(ValueFuzzError);
  });
});

describe("fuzzAssociative", () => {
  test("resolves for an associative operation", async () => {
    await expect(
      fuzzAssociative<z.infer<typeof numberSchema>>({
        schema: numberSchema,
        numRuns: 48,
        seed: 2,
        operation: (a, b) => ({ n: a.n + b.n }),
      }),
    ).resolves.toBeUndefined();
  });

  test("rejects when the operation is not associative", async () => {
    await expect(
      fuzzAssociative<z.infer<typeof numberSchema>>({
        schema: numberSchema,
        numRuns: 64,
        seed: 2,
        operation: (a, b) => ({ n: a.n - b.n }),
      }),
    ).rejects.toBeInstanceOf(ValueFuzzError);
  });
});

describe("fuzzMonotonic", () => {
  test("resolves when mapping preserves ordering", async () => {
    await expect(
      fuzzMonotonic<z.infer<typeof numberSchema>, number>({
        schema: numberSchema,
        numRuns: 48,
        seed: 5,
        compareInput: (a, b) => a.n - b.n,
        mapping: ({ n }) => n * 2,
      }),
    ).resolves.toBeUndefined();
  });

  test("rejects when mapping flips ordering", async () => {
    await expect(
      fuzzMonotonic<z.infer<typeof numberSchema>, number>({
        schema: numberSchema,
        numRuns: 64,
        seed: 5,
        compareInput: (a, b) => a.n - b.n,
        mapping: ({ n }) => -n,
      }),
    ).rejects.toBeInstanceOf(ValueFuzzError);
  });

  test("rejects when equal inputs produce different outputs", async () => {
    let toggled = false;
    await expect(
      fuzzMonotonic<{ n: number }, number>({
        schema: z.object({ n: z.number().int().min(0).max(3) }),
        numRuns: 64,
        seed: 7,
        compareInput: (a, b) => a.n - b.n,
        mapping({ n }) {
          toggled = !toggled;
          return toggled ? n : n + 1;
        },
      }),
    ).rejects.toBeInstanceOf(ValueFuzzError);
  });
});
