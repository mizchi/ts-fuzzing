import { describe, expect, test } from "vitest";
import * as z from "zod";
import {
  ValueFuzzError,
  fuzzCommutativeMonoid,
  fuzzFunctor,
  fuzzMonoid,
  fuzzSemigroup,
} from "../src/index.js";

const numberSchema = z.object({ n: z.number().int().min(-8).max(8) });
const stringSchema = z.object({ s: z.string().max(6) });

describe("fuzzSemigroup", () => {
  test("resolves for an associative op", async () => {
    await expect(
      fuzzSemigroup<z.infer<typeof numberSchema>>({
        schema: numberSchema,
        numRuns: 32,
        seed: 1,
        op: (a, b) => ({ n: a.n + b.n }),
      }),
    ).resolves.toBeUndefined();
  });

  test("rejects when the op is not associative", async () => {
    await expect(
      fuzzSemigroup<z.infer<typeof numberSchema>>({
        schema: numberSchema,
        numRuns: 32,
        seed: 1,
        op: (a, b) => ({ n: a.n - b.n }),
      }),
    ).rejects.toBeInstanceOf(ValueFuzzError);
  });
});

describe("fuzzMonoid", () => {
  test("resolves when identity and associativity hold", async () => {
    await expect(
      fuzzMonoid<z.infer<typeof stringSchema>>({
        schema: stringSchema,
        numRuns: 32,
        seed: 2,
        identity: { s: "" },
        op: (a, b) => ({ s: a.s + b.s }),
      }),
    ).resolves.toBeUndefined();
  });

  test("rejects when the identity element is wrong", async () => {
    await expect(
      fuzzMonoid<z.infer<typeof stringSchema>>({
        schema: stringSchema,
        numRuns: 32,
        seed: 2,
        identity: { s: "x" },
        op: (a, b) => ({ s: a.s + b.s }),
      }),
    ).rejects.toBeInstanceOf(ValueFuzzError);
  });
});

describe("fuzzCommutativeMonoid", () => {
  test("resolves for + over integers with identity 0", async () => {
    await expect(
      fuzzCommutativeMonoid<z.infer<typeof numberSchema>>({
        schema: numberSchema,
        numRuns: 32,
        seed: 3,
        identity: { n: 0 },
        op: (a, b) => ({ n: a.n + b.n }),
      }),
    ).resolves.toBeUndefined();
  });

  test("rejects when the op is not commutative (subtraction)", async () => {
    await expect(
      fuzzCommutativeMonoid<z.infer<typeof numberSchema>>({
        schema: numberSchema,
        numRuns: 32,
        seed: 3,
        identity: { n: 0 },
        op: (a, b) => ({ n: a.n - b.n }),
      }),
    ).rejects.toBeInstanceOf(ValueFuzzError);
  });
});

describe("fuzzFunctor", () => {
  const boxSchema = z.object({ value: z.number().int().min(-8).max(8) });
  type Box = z.infer<typeof boxSchema>;
  const boxMap = <X, Y>(box: Box, fn: (value: X) => Y): Box => ({
    value: fn(box.value as unknown as X) as unknown as number,
  });

  test("resolves for a lawful map", async () => {
    await expect(
      fuzzFunctor<Box, number, number, number>({
        schema: boxSchema,
        numRuns: 24,
        seed: 4,
        map: boxMap,
        composeFns: [(value) => value + 1, (value) => value * 2],
      }),
    ).resolves.toBeUndefined();
  });

  test("rejects when map breaks identity", async () => {
    await expect(
      fuzzFunctor<Box, number, number, number>({
        schema: boxSchema,
        numRuns: 24,
        seed: 4,
        map: ((box: Box, fn: (value: number) => number) => ({
          value: fn(box.value) + 1,
        })) as never,
        composeFns: [(value) => value + 1, (value) => value * 2],
      }),
    ).rejects.toBeInstanceOf(ValueFuzzError);
  });
});
