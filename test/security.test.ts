import fc from "fast-check";
import { describe, expect, test } from "vitest";
import {
  xssCorpus,
  xssCorpusByCategory,
  xssPayloads,
  xssPayloadsByCategory,
} from "../src/security.js";
import { domainBoundaryStrings, domainStringArbitrary } from "../src/string_constraints.js";

describe("XSS corpus", () => {
  test("ships a non-trivial curated corpus", () => {
    expect(xssCorpus.length).toBeGreaterThan(20);
    expect(new Set(xssCorpus).size).toBe(xssCorpus.length);
  });

  test("xssPayloads samples from the corpus", () => {
    const samples = fc.sample(xssPayloads, { numRuns: 50, seed: 1 });
    expect(samples.length).toBe(50);
    for (const sample of samples) {
      expect(xssCorpus).toContain(sample);
    }
  });

  test("category-specific arbitraries draw only from that category", () => {
    for (const category of Object.keys(xssCorpusByCategory) as Array<keyof typeof xssCorpusByCategory>) {
      const arbitrary = xssPayloadsByCategory(category);
      const samples = fc.sample(arbitrary, { numRuns: 10, seed: 1 });
      for (const sample of samples) {
        expect(xssCorpusByCategory[category]).toContain(sample);
      }
    }
  });

  test("string_constraints xss pattern exposes the corpus", () => {
    const boundary = domainBoundaryStrings({ pattern: "xss" });
    expect(boundary).toBeDefined();
    expect(boundary!.length).toBeGreaterThan(0);
    for (const value of boundary!) {
      expect(xssCorpus).toContain(value);
    }

    const arbitrary = domainStringArbitrary({ pattern: "xss" });
    expect(arbitrary).toBeDefined();
    const samples = fc.sample(arbitrary!, { numRuns: 5, seed: 1 });
    for (const sample of samples) {
      expect(xssCorpus).toContain(sample);
    }
  });

  test("respects maxLength filter", () => {
    const filtered = domainBoundaryStrings({ pattern: "xss", maxLength: 12 });
    expect(filtered).toBeDefined();
    for (const value of filtered!) {
      expect(value.length).toBeLessThanOrEqual(12);
    }
  });
});
