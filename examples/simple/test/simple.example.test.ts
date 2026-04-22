import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as v from "valibot";
import * as z from "zod";
import { afterEach, describe, expect, test } from "vitest";
import {
  ValueFuzzError,
  fuzzValues,
  fuzzValuesGuided,
  quickCheckValues,
  sampleBoundaryValues,
  sampleBoundaryValuesFromSchema,
  sampleValues,
  sampleValuesFromSchema,
} from "ts-fuzzing";
import { buildSearchPath, normalizeQuery, type SearchQuery } from "../src/SearchQuery.js";

const searchQueryPath = new URL("../src/SearchQuery.ts", import.meta.url);

const querySchema = z.object({
  page: z.coerce.number().int().min(1).max(3),
  sort: z.enum(["recent", "relevance"]).optional(),
  term: z.string().min(1).max(8).transform((value) => value.trim().toLowerCase()),
});

const valibotQuerySchema = v.object({
  page: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(3)),
  sort: v.optional(v.picklist(["recent", "relevance"])),
  term: v.pipe(v.string(), v.minLength(1), v.maxLength(8)),
});

const tempDirs: string[] = [];

const makeTempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-fuzzing-simple-example-"));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { force: true, recursive: true });
  }
});

describe("simple example project", () => {
  test("samples values and fuzzes a plain callback", async () => {
    const values: SearchQuery[] = [];
    for await (const value of sampleValues<SearchQuery>({
      sourcePath: searchQueryPath,
      typeName: "SearchQuery",
      numRuns: 4,
      seed: 7,
    })) {
      values.push(value);
    }

    expect(values).toHaveLength(4);
    expect(values.every((value) => typeof value.term === "string")).toBe(true);
    expect(values.every((value) => value.page >= 1 && value.page <= 5)).toBe(true);

    await expect(
      fuzzValues<SearchQuery>({
        sourcePath: searchQueryPath,
        typeName: "SearchQuery",
        numRuns: 24,
        seed: 7,
        run(value) {
          const normalized = normalizeQuery(value);
          const path = buildSearchPath(normalized);
          expect(path.startsWith("/search?")).toBe(true);
        },
      }),
    ).resolves.toBeUndefined();
  }, 10_000);

  test("quick-check reports boundary failures as ValueFuzzError", async () => {
    await expect(
      quickCheckValues<SearchQuery>({
        sourcePath: searchQueryPath,
        typeName: "SearchQuery",
        maxCases: 64,
        run(value) {
          if (value.page === 5 && value.sort === "recent") {
            throw new Error("recent page 5 is blocked");
          }
        },
      }),
    ).rejects.toMatchObject({
      name: "ValueFuzzError",
      failingValue: {
        page: 5,
        sort: "recent",
      },
    });
  });

  test("sampleBoundaryValues surfaces the edge cases directly", async () => {
    const values: SearchQuery[] = [];
    for await (const value of sampleBoundaryValues<SearchQuery>({
      sourcePath: searchQueryPath,
      typeName: "SearchQuery",
      maxCases: 16,
    })) {
      values.push(value);
    }

    expect(values.some((value) => value.page === 1)).toBe(true);
    expect(values.some((value) => value.page === 5)).toBe(true);
  });

  test("samples normalized values directly from Zod", async () => {
    const values: Array<z.infer<typeof querySchema>> = [];
    for await (const value of sampleValuesFromSchema({
      schema: querySchema,
      numRuns: 6,
      seed: 1,
    })) {
      values.push(value);
    }

    expect(values).toHaveLength(6);
    for (const value of values) {
      expect(value.term).toBe(value.term.trim().toLowerCase());
      expect(value.page).toBeGreaterThanOrEqual(1);
      expect(value.page).toBeLessThanOrEqual(3);
    }
  });

  test("ValueFuzzError exposes the minimized failing value", async () => {
    try {
      await fuzzValues<SearchQuery>({
        sourcePath: searchQueryPath,
        typeName: "SearchQuery",
        numRuns: 32,
        seed: 3,
        run(value) {
          if (value.page === 5 && value.sort === "recent") {
            throw new Error("recent page 5 is blocked");
          }
        },
      });
      throw new Error("expected ValueFuzzError");
    } catch (error) {
      expect(error).toBeInstanceOf(ValueFuzzError);
      if (!(error instanceof ValueFuzzError)) {
        throw error;
      }
      expect(error.failingValue).toMatchObject({
        page: 5,
        sort: "recent",
      });
      expect(error.warnings).toEqual([]);
    }
  });

  test("samples normalized values directly from a valibot schema", async () => {
    const values: Array<v.InferOutput<typeof valibotQuerySchema>> = [];
    for await (const value of sampleValuesFromSchema({
      schema: valibotQuerySchema,
      numRuns: 6,
      seed: 1,
    })) {
      values.push(value);
    }

    expect(values).toHaveLength(6);
    for (const value of values) {
      expect(value.page).toBeGreaterThanOrEqual(1);
      expect(value.page).toBeLessThanOrEqual(3);
      expect(value.term.length).toBeGreaterThanOrEqual(1);
      expect(value.term.length).toBeLessThanOrEqual(8);
    }
  });

  test("sampleBoundaryValuesFromSchema surfaces boundary cases from a schema", async () => {
    const values: Array<v.InferOutput<typeof valibotQuerySchema>> = [];
    for await (const value of sampleBoundaryValuesFromSchema({
      schema: valibotQuerySchema,
      maxCases: 32,
    })) {
      values.push(value);
    }

    expect(values.some((value) => value.page === 1)).toBe(true);
    expect(values.some((value) => value.page === 3)).toBe(true);
    expect(values.some((value) => value.term.length === 1)).toBe(true);
  });

  test("guided mode persists a value corpus while running", async () => {
    const corpusDir = makeTempDir();
    const corpusPath = path.join(corpusDir, "search-query-corpus.json");

    const report = await fuzzValuesGuided<SearchQuery>({
      sourcePath: searchQueryPath,
      typeName: "SearchQuery",
      corpusPath,
      initialCorpusSize: 4,
      maxIterations: 8,
      seed: 17,
      run(value) {
        normalizeQuery(value);
      },
    });

    expect(report.iterations).toBe(8);
    expect(fs.existsSync(corpusPath)).toBe(true);
    expect(report.corpusSize).toBeGreaterThan(0);
  });
});
