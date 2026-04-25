import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import fc from "fast-check";
import { afterEach, describe, expect, test } from "vitest";
import * as z from "zod";
import {
  StatefulFuzzError,
  ValueFuzzError,
  fuzzDifferential,
  fuzzIdempotent,
  fuzzRoundtrip,
  fuzzStateful,
  fuzzValues,
  renderReproTest,
  writeReproTest,
} from "../src/index.js";

const tempDirs: string[] = [];

const makeTempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-fuzzing-ext-"));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { force: true, recursive: true });
  }
});

describe("invariant helpers", () => {
  const recordSchema = z.object({
    name: z.string().min(1).max(16),
    count: z.number().int().min(0).max(9),
  });

  test("fuzzRoundtrip resolves when decode(encode(x)) === x", async () => {
    await expect(
      fuzzRoundtrip<z.infer<typeof recordSchema>, string>({
        schema: recordSchema,
        numRuns: 32,
        seed: 1,
        encode(value) {
          return JSON.stringify(value);
        },
        decode(text) {
          return JSON.parse(text);
        },
      }),
    ).resolves.toBeUndefined();
  });

  test("fuzzRoundtrip surfaces a ValueFuzzError when the pair is lossy", async () => {
    await expect(
      fuzzRoundtrip<z.infer<typeof recordSchema>, string>({
        schema: recordSchema,
        numRuns: 32,
        seed: 1,
        encode(value) {
          return JSON.stringify({ name: value.name });
        },
        decode(text) {
          return JSON.parse(text);
        },
      }),
    ).rejects.toBeInstanceOf(ValueFuzzError);
  });

  test("fuzzIdempotent rejects when applying twice changes the result", async () => {
    const schema = z.object({
      counter: z.number().int().min(0).max(3),
    });
    await expect(
      fuzzIdempotent<z.infer<typeof schema>>({
        schema,
        numRuns: 32,
        seed: 1,
        apply(value) {
          return { counter: value.counter + 1 };
        },
      }),
    ).rejects.toBeInstanceOf(ValueFuzzError);
  });

  test("fuzzIdempotent resolves when the op is actually idempotent", async () => {
    const schema = z.object({ text: z.string().min(1).max(6) });
    await expect(
      fuzzIdempotent<z.infer<typeof schema>>({
        schema,
        numRuns: 24,
        seed: 4,
        apply(value) {
          return { text: value.text.trim() };
        },
      }),
    ).resolves.toBeUndefined();
  });
});

describe("differential fuzzing", () => {
  const numberSchema = z.object({ value: z.number().int().min(-8).max(8) });

  test("resolves when implementations agree", async () => {
    await expect(
      fuzzDifferential<z.infer<typeof numberSchema>, number>({
        schema: numberSchema,
        numRuns: 32,
        seed: 3,
        implementations: [
          ({ value }) => value * 2,
          ({ value }) => value + value,
        ],
      }),
    ).resolves.toBeUndefined();
  });

  test("rejects with failing value when implementations disagree", async () => {
    await expect(
      fuzzDifferential<z.infer<typeof numberSchema>, number>({
        schema: numberSchema,
        numRuns: 48,
        seed: 3,
        names: ["doubler", "broken-doubler"],
        implementations: [
          ({ value }) => value * 2,
          ({ value }) => (value === 3 ? 999 : value * 2),
        ],
      }),
    ).rejects.toMatchObject({
      name: "ValueFuzzError",
      failingValue: { value: 3 },
    });
  });
});

describe("repro test export", () => {
  const error = new ValueFuzzError("example", {
    cause: new Error("boom"),
    failingValue: { page: 5, sort: "recent" },
    seed: 42,
  });

  test("renderReproTest produces a runnable vitest file", () => {
    const source = renderReproTest({
      error,
      runnerImport: "../src/runner.js",
      runnerSymbol: "runSearch",
    });
    expect(source).toContain('import { test } from "vitest";');
    expect(source).toContain('import { runSearch } from "../src/runner.js";');
    expect(source).toContain("seed: 42");
    expect(source).toContain('"page": 5');
    expect(source).toContain("async () =>");
    expect(source).toContain("await runSearch(failingValue);");
  });

  test("renderReproTest supports the node:test runner", () => {
    const source = renderReproTest({ error, framework: "node:test" });
    expect(source).toContain('import { test } from "node:test";');
  });

  test("writeReproTest writes the rendered file to disk", () => {
    const dir = makeTempDir();
    const outputPath = path.join(dir, "repro.test.ts");
    const written = writeReproTest({
      error,
      outputPath,
      runnerImport: "./search.js",
      runnerSymbol: "runSearch",
    });
    expect(written).toBe(outputPath);
    const body = fs.readFileSync(outputPath, "utf8");
    expect(body).toContain("await runSearch(failingValue);");
    expect(body).toContain("async () =>");
  });
});

describe("stateful fuzzing", () => {
  test("resolves when the model and real implementation agree", async () => {
    await expect(
      fuzzStateful<{ items: number[] }, number[]>({
        setup: () => ({ model: { items: [] }, real: [] }),
        actions: [
          {
            name: "push",
            generate: fc.integer({ min: 0, max: 9 }),
            apply({ model, real, input }) {
              model.items.push(input);
              real.push(input);
            },
          },
          {
            name: "pop",
            precondition: (model) => model.items.length > 0,
            apply({ model, real }) {
              model.items.pop();
              real.pop();
            },
          },
        ],
        invariant({ model, real }) {
          if (model.items.length !== real.length) {
            throw new Error(`length mismatch: model=${model.items.length} real=${real.length}`);
          }
        },
        maxActions: 20,
        numRuns: 32,
        seed: 1,
      }),
    ).resolves.toBeUndefined();
  });

  test("rejects with a failing trace when the real implementation diverges", async () => {
    await expect(
      fuzzStateful<{ count: number }, { count: number }>({
        setup: () => ({ model: { count: 0 }, real: { count: 0 } }),
        actions: [
          {
            name: "increment",
            apply({ model, real }) {
              model.count += 1;
              real.count += real.count >= 3 ? 2 : 1;
            },
          },
        ],
        invariant({ model, real }) {
          if (model.count !== real.count) {
            throw new Error(`count diverged: model=${model.count} real=${real.count}`);
          }
        },
        maxActions: 10,
        numRuns: 16,
        seed: 2,
      }),
    ).rejects.toBeInstanceOf(StatefulFuzzError);
  });

  test("failing trace records the sequence of applied actions", async () => {
    let caught: unknown;
    try {
      await fuzzStateful<{ seen: number }, { seen: number }>({
        setup: () => ({ model: { seen: 0 }, real: { seen: 0 } }),
        actions: [
          {
            name: "bump",
            generate: fc.integer({ min: 0, max: 3 }),
            apply({ model, real, input }) {
              model.seen = input;
              real.seen = input === 2 ? 999 : input;
            },
          },
        ],
        invariant({ model, real }) {
          if (model.seen !== real.seen) {
            throw new Error("diverged");
          }
        },
        maxActions: 4,
        numRuns: 32,
        seed: 1,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(StatefulFuzzError);
    if (caught instanceof StatefulFuzzError) {
      expect(caught.failingTrace.length).toBeGreaterThan(0);
      expect(caught.failingTrace[caught.failingTrace.length - 1].action).toBe("bump");
    }
  });
});

describe("time budget options", () => {
  test("timeoutMs interrupts the run without marking it as a failure", async () => {
    const start = Date.now();
    await expect(
      fuzzValues({
        schema: z.number(),
        numRuns: 1_000_000,
        timeoutMs: 50,
        seed: 1,
        run() {
          // loop body kept short so fast-check can interrupt promptly
        },
      }),
    ).resolves.toBeUndefined();
    expect(Date.now() - start).toBeLessThan(2_000);
  });
});
