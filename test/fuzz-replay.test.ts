import { describe, expect, test } from "vitest";
import * as z from "zod";
import {
  ValueFuzzError,
  fuzzValues,
  replayFromError,
  replayValues,
} from "../src/index.js";

const schema = z.object({ n: z.number().int().min(0).max(9) });

describe("replayValues", () => {
  test("produces the same sequence for the same seed", async () => {
    const first = await replayValues<z.infer<typeof schema>>({
      schema,
      numRuns: 16,
      seed: 42,
    });
    const second = await replayValues<z.infer<typeof schema>>({
      schema,
      numRuns: 16,
      seed: 42,
    });

    expect(first.iterations.map((step) => step.value)).toEqual(
      second.iterations.map((step) => step.value),
    );
    expect(first.failures).toEqual([]);
    expect(first.totalRuns).toBe(16);
    expect(first.seed).toBe(42);
  });

  test("records failed iterations without stopping", async () => {
    const report = await replayValues<z.infer<typeof schema>>({
      schema,
      numRuns: 32,
      seed: 7,
      run(value) {
        if (value.n === 0) {
          throw new Error("zero");
        }
      },
    });

    expect(report.totalRuns).toBe(32);
    expect(report.iterations).toHaveLength(32);
    const failed = report.iterations.filter((step) => step.failed);
    expect(failed.length).toBe(report.failures.length);
    if (report.failures.length > 0) {
      expect(report.failures[0].cause).toBeInstanceOf(Error);
      expect(report.failures[0].value.n).toBe(0);
    }
  });

  test("stopOnFirstFailure truncates the iteration list", async () => {
    const full = await replayValues<z.infer<typeof schema>>({
      schema,
      numRuns: 32,
      seed: 7,
      run(value) {
        if (value.n === 0) {
          throw new Error("zero");
        }
      },
    });
    if (full.failures.length === 0) {
      return;
    }

    const truncated = await replayValues<z.infer<typeof schema>>({
      schema,
      numRuns: 32,
      seed: 7,
      stopOnFirstFailure: true,
      run(value) {
        if (value.n === 0) {
          throw new Error("zero");
        }
      },
    });

    expect(truncated.iterations.length).toBeLessThanOrEqual(full.iterations.length);
    expect(truncated.iterations[truncated.iterations.length - 1].failed).toBe(true);
    expect(truncated.failures).toHaveLength(1);
  });

  test("onIteration hook receives every step in order", async () => {
    const seen: number[] = [];
    await replayValues<z.infer<typeof schema>>({
      schema,
      numRuns: 8,
      seed: 1,
      onIteration(step) {
        seen.push(step.iteration);
      },
    });
    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe("replayFromError", () => {
  test("re-walks a fuzzValues failure by seed and lands on the same input", async () => {
    const isBlocked = (value: { n: number }) => value.n === 3;
    const runCheck = (value: { n: number }) => {
      if (isBlocked(value)) {
        throw new Error("three");
      }
    };

    let caught: ValueFuzzError | undefined;
    try {
      await fuzzValues<z.infer<typeof schema>>({
        schema,
        numRuns: 64,
        seed: 99,
        run: runCheck,
      });
    } catch (error) {
      if (error instanceof ValueFuzzError) {
        caught = error;
      }
    }

    expect(caught).toBeInstanceOf(ValueFuzzError);
    if (!caught) {
      return;
    }

    const report = await replayFromError<z.infer<typeof schema>>({
      error: caught,
      schema,
      numRuns: 64,
      run: runCheck,
    });

    expect(report.seed).toBe(99);
    expect(report.failures.length).toBeGreaterThan(0);
    expect(report.failures.some((step) => step.value.n === 3)).toBe(true);
  });

  test("throws if the error carries no seed", async () => {
    const errorWithoutSeed = new ValueFuzzError("no seed", {
      cause: new Error("x"),
      failingValue: {},
    });
    await expect(
      replayFromError({
        error: errorWithoutSeed,
        schema,
        run() {},
      }),
    ).rejects.toThrow(/requires a ValueFuzzError that carries a seed/);
  });
});
