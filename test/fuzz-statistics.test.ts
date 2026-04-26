import { describe, expect, test } from "vitest";
import * as z from "zod";
import { collectStatistics, formatStatistics } from "../src/index.js";

const schema = z.object({ n: z.number().int().min(0).max(9) });

describe("collectStatistics", () => {
  test("counts every classification across the sampled iterations", async () => {
    const report = await collectStatistics<z.infer<typeof schema>>({
      schema,
      classify: (value) => (value.n % 2 === 0 ? "even" : "odd"),
      numRuns: 100,
      seed: 1,
    });

    expect(report.iterations).toBe(100);
    const total = report.buckets.reduce((sum, bucket) => sum + bucket.count, 0);
    expect(total).toBe(100);
    expect(report.buckets.some((bucket) => bucket.label === "even")).toBe(true);
    expect(report.buckets.some((bucket) => bucket.label === "odd")).toBe(true);
  });

  test("supports multi-label classification per input", async () => {
    const report = await collectStatistics<z.infer<typeof schema>>({
      schema,
      classify: (value) => {
        const labels = [value.n % 2 === 0 ? "even" : "odd"];
        if (value.n === 0 || value.n === 9) {
          labels.push("boundary");
        }
        return labels;
      },
      numRuns: 64,
      seed: 2,
    });

    const total = report.buckets.reduce((sum, bucket) => sum + bucket.count, 0);
    expect(total).toBeGreaterThanOrEqual(64);
    expect(report.buckets.some((bucket) => bucket.label === "boundary")).toBe(true);
  });

  test("undefined classification skips a sample without erroring", async () => {
    const report = await collectStatistics<z.infer<typeof schema>>({
      schema,
      classify: (value) => (value.n < 5 ? "low" : undefined),
      numRuns: 32,
      seed: 3,
    });

    const lowBucket = report.buckets.find((bucket) => bucket.label === "low");
    expect(lowBucket).toBeDefined();
    if (lowBucket) {
      expect(lowBucket.count).toBeLessThanOrEqual(32);
      expect(lowBucket.count).toBeGreaterThan(0);
    }
  });

  test("returns ratios summing to roughly 1 for non-overlapping labels", async () => {
    const report = await collectStatistics<z.infer<typeof schema>>({
      schema,
      classify: (value) => (value.n % 2 === 0 ? "even" : "odd"),
      numRuns: 200,
      seed: 4,
    });

    const totalRatio = report.buckets.reduce((sum, bucket) => sum + bucket.ratio, 0);
    expect(totalRatio).toBeCloseTo(1, 5);
  });
});

describe("formatStatistics", () => {
  test("renders an aligned histogram-style summary", () => {
    const formatted = formatStatistics({
      buckets: [
        { count: 60, label: "even", ratio: 0.6 },
        { count: 40, label: "odd", ratio: 0.4 },
      ],
      iterations: 100,
      warnings: [],
    });
    const lines = formatted.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("even");
    expect(lines[0]).toContain("60.0%");
    expect(lines[1]).toContain("odd");
    expect(lines[1]).toContain("40.0%");
  });

  test("returns a friendly message when no labels were classified", () => {
    expect(
      formatStatistics({ buckets: [], iterations: 0, warnings: [] }),
    ).toContain("no labels classified");
  });
});
