import * as z from "zod";
import { describe, expect, test } from "vitest";
import {
  ValueFuzzError,
  fuzzValues,
  quickCheckValues,
  sampleBoundaryValues,
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

describe("simple example project", () => {
  test("samples values and fuzzes a plain callback", async () => {
    const values = await sampleValues<SearchQuery>({
      sourcePath: searchQueryPath,
      typeName: "SearchQuery",
      numRuns: 4,
      seed: 7,
    });

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
  });

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
    const values = await sampleBoundaryValues<SearchQuery>({
      sourcePath: searchQueryPath,
      typeName: "SearchQuery",
      maxCases: 16,
    });

    expect(values.some((value) => value.page === 1)).toBe(true);
    expect(values.some((value) => value.page === 5)).toBe(true);
  });

  test("samples normalized values directly from Zod", async () => {
    const values = await sampleValuesFromSchema({
      schema: querySchema,
      numRuns: 6,
      seed: 1,
    });

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
});
