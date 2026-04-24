import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import * as z from "zod";
import {
  ValueFuzzError,
  fuzzFromCorpusWithMutation,
  generateMutations,
  mutateValue,
  saveCorpus,
} from "../src/index.js";

const tempDirs: string[] = [];

const makeTempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-fuzzing-mutation-"));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { force: true, recursive: true });
  }
});

const schema = z.object({
  n: z.number().int().min(0).max(9),
  tag: z.enum(["safe", "danger"]),
});

describe("mutateValue / generateMutations", () => {
  test("mutateValue is deterministic for the same seed", () => {
    const original = { n: 5, tag: "safe" as const };
    const a = mutateValue({ schema, seed: 7, value: original });
    const b = mutateValue({ schema, seed: 7, value: original });
    expect(a).toEqual(b);
  });

  test("mutated values continue to satisfy the descriptor shape", () => {
    const original = { n: 5, tag: "safe" as const };
    for (let i = 0; i < 32; i += 1) {
      const mutated = mutateValue<{ n: number; tag: string }>({
        schema,
        seed: i,
        value: original,
      });
      expect(typeof mutated.n).toBe("number");
      expect(Number.isInteger(mutated.n)).toBe(true);
      expect(mutated.n).toBeGreaterThanOrEqual(0);
      expect(mutated.n).toBeLessThanOrEqual(9);
      expect(["safe", "danger"]).toContain(mutated.tag);
    }
  });

  test("generateMutations produces the requested count", () => {
    const mutations = generateMutations({
      schema,
      count: 10,
      seed: 3,
      value: { n: 5, tag: "safe" },
    });
    expect(mutations).toHaveLength(10);
  });

  test("generateMutations returns an empty array when count <= 0", () => {
    expect(
      generateMutations({
        schema,
        count: 0,
        value: { n: 5, tag: "safe" },
      }),
    ).toEqual([]);
  });
});

describe("fuzzFromCorpusWithMutation", () => {
  test("expands a single corpus entry into multiple mutations and runs each", async () => {
    const dir = makeTempDir();
    const corpusPath = path.join(dir, "mutation-ok.json");
    saveCorpus({ corpusPath, corpus: [{ n: 5, tag: "safe" }] });

    const report = await fuzzFromCorpusWithMutation<{ n: number; tag: string }>({
      corpusPath,
      schema,
      mutationsPerEntry: 6,
      seed: 1,
      run() {},
    });

    expect(report.totalEntries).toBe(1);
    expect(report.attempts).toBe(6);
    expect(report.passed).toBe(6);
    expect(report.failures).toEqual([]);
  });

  test("reports mutation failures with origin and mutation references", async () => {
    const dir = makeTempDir();
    const corpusPath = path.join(dir, "mutation-fail.json");
    saveCorpus({ corpusPath, corpus: [{ n: 5, tag: "safe" }] });

    const report = await fuzzFromCorpusWithMutation<{ n: number; tag: string }>({
      corpusPath,
      schema,
      collectAllFailures: true,
      mutationsPerEntry: 32,
      seed: 2,
      run(value) {
        if (value.n !== 5) {
          throw new Error(`mutated away from 5: ${value.n}`);
        }
      },
    });

    expect(report.totalEntries).toBe(1);
    expect(report.attempts).toBe(32);
    expect(report.failures.length).toBeGreaterThan(0);
    for (const failure of report.failures) {
      expect(failure.originIndex).toBe(0);
      expect(failure.origin).toEqual({ n: 5, tag: "safe" });
      expect(failure.mutation.n).not.toBe(5);
    }
  });

  test("throws a ValueFuzzError on the first mutation failure by default", async () => {
    const dir = makeTempDir();
    const corpusPath = path.join(dir, "mutation-stop.json");
    saveCorpus({ corpusPath, corpus: [{ n: 5, tag: "safe" }] });

    await expect(
      fuzzFromCorpusWithMutation<{ n: number; tag: string }>({
        corpusPath,
        schema,
        mutationsPerEntry: 32,
        seed: 2,
        run(value) {
          if (value.n !== 5) {
            throw new Error("mutated away from 5");
          }
        },
      }),
    ).rejects.toBeInstanceOf(ValueFuzzError);
  });
});
