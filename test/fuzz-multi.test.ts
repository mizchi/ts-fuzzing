import { describe, expect, test } from "vitest";
import * as z from "zod";
import { fuzzValuesMulti } from "../src/index.js";

describe("fuzzValuesMulti", () => {
  test("resolves with an empty failure list when every run passes", async () => {
    const report = await fuzzValuesMulti({
      schema: z.object({ n: z.number().int().min(0).max(9) }),
      numRuns: 64,
      seed: 1,
      run() {
        // no-op
      },
    });

    expect(report.totalRuns).toBe(64);
    expect(report.failures).toEqual([]);
    expect(report.iterations).toBeGreaterThan(0);
  });

  test("collects multiple distinct failing values in a single run", async () => {
    const schema = z.object({ n: z.number().int().min(0).max(9) });
    const report = await fuzzValuesMulti<z.infer<typeof schema>>({
      schema,
      numRuns: 256,
      seed: 7,
      run(value) {
        if (value.n % 3 === 0) {
          throw new Error(`divisible by three: ${value.n}`);
        }
      },
    });

    const uniqueValues = new Set(report.failures.map((failure) => failure.value.n));
    expect(report.failures.length).toBeGreaterThan(1);
    expect(uniqueValues.size).toBe(report.failures.length);
    for (const failure of report.failures) {
      expect(failure.value.n % 3).toBe(0);
      expect(failure.cause).toBeInstanceOf(Error);
      expect(failure.iteration).toBeGreaterThan(0);
    }
  });

  test("maxFailures stops collection after the requested count", async () => {
    const schema = z.object({ n: z.number().int().min(0).max(99) });
    const report = await fuzzValuesMulti<z.infer<typeof schema>>({
      schema,
      maxFailures: 3,
      numRuns: 512,
      seed: 11,
      run(value) {
        if (value.n % 2 === 0) {
          throw new Error(`even: ${value.n}`);
        }
      },
    });

    expect(report.failures).toHaveLength(3);
    const values = report.failures.map((failure) => failure.value.n);
    expect(new Set(values).size).toBe(3);
  });

  test("deduplicates identical failing values", async () => {
    const report = await fuzzValuesMulti({
      schema: z.object({ tag: z.enum(["safe", "explode"]) }),
      numRuns: 64,
      seed: 3,
      run(value) {
        if ((value as { tag: string }).tag === "explode") {
          throw new Error("exploded");
        }
      },
    });

    expect(report.failures.length).toBeLessThanOrEqual(1);
    if (report.failures.length === 1) {
      expect(report.failures[0].value).toEqual({ tag: "explode" });
    }
  });
});
