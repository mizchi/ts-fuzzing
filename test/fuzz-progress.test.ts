import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import * as z from "zod";
import {
  ValueFuzzError,
  fuzzFromCorpus,
  fuzzFromCorpusWithMutation,
  fuzzValues,
  fuzzValuesMulti,
  saveCorpus,
  type ProgressEvent,
} from "../src/index.js";

const tempDirs: string[] = [];

const makeTempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-fuzzing-progress-"));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { force: true, recursive: true });
  }
});

const schema = z.object({ n: z.number().int().min(0).max(9) });

describe("onProgress", () => {
  test("fuzzValues fires the hook at least once with totalRuns and elapsed", async () => {
    const events: ProgressEvent[] = [];
    await fuzzValues({
      schema,
      numRuns: 32,
      seed: 1,
      progressIntervalMs: 0,
      onProgress(event) {
        events.push(event);
      },
      run() {},
    });

    expect(events.length).toBeGreaterThan(0);
    const last = events[events.length - 1];
    expect(last.totalRuns).toBe(32);
    expect(last.iteration).toBe(32);
    expect(last.failures).toBe(0);
    expect(last.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  test("fuzzValues throttles by progressIntervalMs", async () => {
    const events: ProgressEvent[] = [];
    await fuzzValues({
      schema,
      numRuns: 64,
      seed: 1,
      progressIntervalMs: 60_000,
      onProgress(event) {
        events.push(event);
      },
      run() {},
    });

    expect(events).toHaveLength(1);
    expect(events[0].iteration).toBe(64);
  });

  test("fuzzValues reports the final failures count when the run rejects", async () => {
    const events: ProgressEvent[] = [];
    await expect(
      fuzzValues<z.infer<typeof schema>>({
        schema,
        numRuns: 32,
        seed: 1,
        progressIntervalMs: 0,
        onProgress(event) {
          events.push(event);
        },
        run(value) {
          if (value.n === 0) {
            throw new Error("zero");
          }
        },
      }),
    ).rejects.toBeInstanceOf(ValueFuzzError);

    const last = events[events.length - 1];
    expect(last.failures).toBeGreaterThanOrEqual(1);
  });

  test("fuzzValuesMulti calls onProgress for every iteration when interval is 0", async () => {
    const events: ProgressEvent[] = [];
    await fuzzValuesMulti<z.infer<typeof schema>>({
      schema,
      numRuns: 16,
      seed: 1,
      progressIntervalMs: 0,
      onProgress(event) {
        events.push(event);
      },
      run() {},
    });

    expect(events.length).toBeGreaterThan(0);
    const last = events[events.length - 1];
    expect(last.totalRuns).toBe(16);
    expect(last.iteration).toBe(16);
  });

  test("fuzzFromCorpus invokes onProgress with totalRuns equal to corpus length", async () => {
    const dir = makeTempDir();
    const corpusPath = path.join(dir, "corpus.json");
    saveCorpus({ corpusPath, corpus: [{ n: 1 }, { n: 2 }, { n: 3 }] });

    const events: ProgressEvent[] = [];
    await fuzzFromCorpus<{ n: number }>({
      corpusPath,
      progressIntervalMs: 0,
      onProgress(event) {
        events.push(event);
      },
      run() {},
    });

    expect(events.length).toBeGreaterThan(0);
    const last = events[events.length - 1];
    expect(last.totalRuns).toBe(3);
    expect(last.iteration).toBe(3);
  });

  test("fuzzFromCorpusWithMutation tracks attempts across all entries", async () => {
    const dir = makeTempDir();
    const corpusPath = path.join(dir, "mutation.json");
    saveCorpus({ corpusPath, corpus: [{ n: 1 }, { n: 2 }] });

    const events: ProgressEvent[] = [];
    await fuzzFromCorpusWithMutation<{ n: number }>({
      corpusPath,
      schema,
      mutationsPerEntry: 4,
      seed: 1,
      progressIntervalMs: 0,
      onProgress(event) {
        events.push(event);
      },
      run() {},
    });

    expect(events.length).toBeGreaterThan(0);
    const last = events[events.length - 1];
    expect(last.totalRuns).toBe(8);
    expect(last.iteration).toBe(8);
  });
});
