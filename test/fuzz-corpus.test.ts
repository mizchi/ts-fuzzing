import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  ValueFuzzError,
  appendToCorpus,
  fuzzFromCorpus,
  loadCorpus,
  saveCorpus,
} from "../src/index.js";

const tempDirs: string[] = [];

const makeTempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-fuzzing-corpus-"));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { force: true, recursive: true });
  }
});

describe("corpus management API", () => {
  test("loadCorpus returns an empty array when the file does not exist", () => {
    const dir = makeTempDir();
    const corpusPath = path.join(dir, "missing.json");
    expect(loadCorpus({ corpusPath })).toEqual([]);
  });

  test("saveCorpus and loadCorpus round-trip values including Map and Set", () => {
    const dir = makeTempDir();
    const corpusPath = path.join(dir, "roundtrip.json");
    const corpus = [
      { id: 1, tags: new Set(["a", "b"]) },
      { id: 2, lookup: new Map<string, number>([["x", 10]]) },
    ];
    saveCorpus({ corpusPath, corpus });

    const reloaded = loadCorpus<{ id: number; tags?: Set<string>; lookup?: Map<string, number> }>({
      corpusPath,
    });
    expect(reloaded).toHaveLength(2);
    expect(reloaded[0].tags).toBeInstanceOf(Set);
    expect(reloaded[0].tags?.has("a")).toBe(true);
    expect(reloaded[1].lookup).toBeInstanceOf(Map);
    expect(reloaded[1].lookup?.get("x")).toBe(10);
  });

  test("appendToCorpus deduplicates entries by serialized value", () => {
    const dir = makeTempDir();
    const corpusPath = path.join(dir, "dedup.json");

    appendToCorpus({ corpusPath, value: { page: 1, term: "foo" } });
    appendToCorpus({ corpusPath, value: { page: 2, term: "bar" } });
    const afterDuplicate = appendToCorpus({ corpusPath, value: { page: 1, term: "foo" } });

    expect(afterDuplicate).toHaveLength(2);
    expect(afterDuplicate.map((entry: any) => entry.page).sort()).toEqual([1, 2]);
  });

  test("appendToCorpus supports URL corpusPath", () => {
    const dir = makeTempDir();
    const corpusPath = path.join(dir, "url.json");
    const corpusUrl = new URL(`file://${corpusPath}`);

    appendToCorpus({ corpusPath: corpusUrl, value: { label: "first" } });
    appendToCorpus({ corpusPath: corpusUrl, value: { label: "second" } });

    expect(loadCorpus({ corpusPath: corpusUrl })).toHaveLength(2);
  });

  test("fuzzFromCorpus resolves with a passing report when every entry succeeds", async () => {
    const dir = makeTempDir();
    const corpusPath = path.join(dir, "ok.json");
    saveCorpus({ corpusPath, corpus: [{ n: 1 }, { n: 2 }, { n: 3 }] });

    const report = await fuzzFromCorpus<{ n: number }>({
      corpusPath,
      run(value) {
        if (value.n < 0) {
          throw new Error("negative");
        }
      },
    });

    expect(report.total).toBe(3);
    expect(report.passed).toBe(3);
    expect(report.failures).toEqual([]);
  });

  test("fuzzFromCorpus throws a ValueFuzzError on the first failing entry by default", async () => {
    const dir = makeTempDir();
    const corpusPath = path.join(dir, "fail.json");
    saveCorpus({ corpusPath, corpus: [{ n: 1 }, { n: -1 }, { n: -2 }] });

    let caught: unknown;
    try {
      await fuzzFromCorpus<{ n: number }>({
        corpusPath,
        run(value) {
          if (value.n < 0) {
            throw new Error(`negative:${value.n}`);
          }
        },
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ValueFuzzError);
    if (caught instanceof ValueFuzzError) {
      expect(caught.failingValue).toEqual({ n: -1 });
    }
  });

  test("fuzzFromCorpus collectAllFailures returns every failing entry in a report", async () => {
    const dir = makeTempDir();
    const corpusPath = path.join(dir, "all.json");
    saveCorpus({ corpusPath, corpus: [{ n: 1 }, { n: -1 }, { n: 2 }, { n: -2 }] });

    const report = await fuzzFromCorpus<{ n: number }>({
      corpusPath,
      collectAllFailures: true,
      run(value) {
        if (value.n < 0) {
          throw new Error(`negative:${value.n}`);
        }
      },
    });

    expect(report.total).toBe(4);
    expect(report.passed).toBe(2);
    expect(report.failures).toHaveLength(2);
    expect(report.failures.map((failure) => failure.value)).toEqual([{ n: -1 }, { n: -2 }]);
  });
});
