import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { arbitraryFromDescriptor } from "../src/arbitrary.js";
import { boundaryValuesFromDescriptor } from "../src/boundary.js";
import {
  domainBoundaryStrings,
  domainStringArbitrary,
  genericBoundaryStrings,
  regexBoundaryStrings,
} from "../src/string_constraints.js";

describe("generator helpers", () => {
  test("builds domain-aware boundary strings", () => {
    expect(domainBoundaryStrings({ pattern: "email" })?.every((value) => value.includes("@"))).toBe(true);
    expect(domainBoundaryStrings({ pattern: "url" })?.every((value) => value.includes("://"))).toBe(true);
    expect(domainBoundaryStrings({ pattern: "email", minLength: 100 })).toEqual([]);
    expect(domainBoundaryStrings({ pattern: "regex" })).toBeUndefined();
  });

  test("builds domain-aware arbitraries", () => {
    const emailArbitrary = domainStringArbitrary({ pattern: "email", minLength: 1 });
    const urlArbitrary = domainStringArbitrary({ pattern: "url", minLength: 1 });

    expect(emailArbitrary).toBeDefined();
    expect(urlArbitrary).toBeDefined();
    expect(fc.sample(emailArbitrary!, { numRuns: 3 }).every((value) => value.includes("@"))).toBe(true);
    expect(fc.sample(urlArbitrary!, { numRuns: 3 }).every((value) => value.includes("://"))).toBe(true);
    expect(domainStringArbitrary({ pattern: "other" })).toBeUndefined();
  });

  test("builds generic and regex boundary strings", () => {
    expect(genericBoundaryStrings({ minLength: 1, maxLength: 3 })).toEqual(["a", "aa", "aaa"]);
    expect(regexBoundaryStrings({ pattern: "a+" }).every((value) => /a+/.test(value))).toBe(true);
    expect(regexBoundaryStrings({ pattern: "email" })).toEqual([]);
  });

  test("samples arbitraries from every descriptor kind", () => {
    const values = [
      fc.sample(arbitraryFromDescriptor({ kind: "unknown" }), { numRuns: 4 }),
      fc.sample(arbitraryFromDescriptor({ kind: "string", constraints: { minLength: 1, maxLength: 2 } }), { numRuns: 4 }),
      fc.sample(arbitraryFromDescriptor({ kind: "string", constraints: { pattern: "email" } }), { numRuns: 2 }),
      fc.sample(arbitraryFromDescriptor({ kind: "string", constraints: { pattern: "a+" } }), { numRuns: 2 }),
      fc.sample(arbitraryFromDescriptor({ kind: "number", integer: true, constraints: { min: 1, max: 2 } }), { numRuns: 4 }),
      fc.sample(arbitraryFromDescriptor({ kind: "number", integer: false, constraints: { min: 1, max: 2 } }), { numRuns: 4 }),
      fc.sample(arbitraryFromDescriptor({ kind: "boolean" }), { numRuns: 2 }),
      fc.sample(arbitraryFromDescriptor({ kind: "literal", value: "x" }), { numRuns: 2 }),
      fc.sample(arbitraryFromDescriptor({ kind: "null" }), { numRuns: 1 }),
      fc.sample(arbitraryFromDescriptor({ kind: "undefined" }), { numRuns: 1 }),
      fc.sample(arbitraryFromDescriptor({ kind: "function" }), { numRuns: 1 }),
      fc.sample(arbitraryFromDescriptor({ kind: "react-node" }), { numRuns: 4 }),
      fc.sample(arbitraryFromDescriptor({ kind: "array", item: { kind: "literal", value: 1 }, constraints: { minItems: 1, maxItems: 2 } }), { numRuns: 4 }),
      fc.sample(arbitraryFromDescriptor({ kind: "tuple", items: [{ kind: "literal", value: "a" }, { kind: "literal", value: 1 }] }), { numRuns: 1 }),
      fc.sample(arbitraryFromDescriptor({ kind: "object", properties: [{ key: "name", optional: false, value: { kind: "literal", value: "ok" } }, { key: "count", optional: true, value: { kind: "number", integer: true } }] }), { numRuns: 4 }),
      fc.sample(arbitraryFromDescriptor({ kind: "union", options: [{ kind: "literal", value: "left" }, { kind: "literal", value: "right" }] }), { numRuns: 4 }),
    ];

    expect(values[1].every((value) => typeof value === "string" && value.length >= 1 && value.length <= 2)).toBe(true);
    expect(values[2].every((value) => typeof value === "string" && value.includes("@"))).toBe(true);
    expect(values[3].every((value) => typeof value === "string" && /a+/.test(String(value)))).toBe(true);
    expect(values[4].every((value) => Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 2)).toBe(true);
    expect(values[5].every((value) => typeof value === "number")).toBe(true);
    expect(values[7]).toEqual(["x", "x"]);
    expect(values[8]).toEqual([null]);
    expect(values[9]).toEqual([undefined]);
    expect(typeof values[10][0]).toBe("function");
    expect(values[12].every((value) => Array.isArray(value) && value.length >= 1 && value.length <= 2)).toBe(true);
    expect(values[13]).toEqual([["a", 1]]);
    expect(values[14].every((value) => value && (value as Record<string, unknown>).name === "ok")).toBe(true);
    expect(values[15].every((value) => value === "left" || value === "right")).toBe(true);
  });

  test("produces boundary values from every descriptor kind", () => {
    expect(boundaryValuesFromDescriptor({ kind: "unknown" })).toEqual([null, "", 0, false, {}]);
    expect(boundaryValuesFromDescriptor({ kind: "string", constraints: { pattern: "email" } }).every((value) => String(value).includes("@"))).toBe(true);
    expect(boundaryValuesFromDescriptor({ kind: "string", constraints: { pattern: "a+" } }).every((value) => /a+/.test(String(value)))).toBe(true);
    expect(boundaryValuesFromDescriptor({ kind: "string", constraints: { minLength: 1, maxLength: 2 } })).toEqual(["a", "aa"]);
    expect(boundaryValuesFromDescriptor({ kind: "number", integer: true, constraints: { min: 1, max: 3 } })).toEqual([1, 2, 3]);
    expect(boundaryValuesFromDescriptor({ kind: "boolean" })).toEqual([false, true]);
    expect(boundaryValuesFromDescriptor({ kind: "literal", value: "x" })).toEqual(["x"]);
    expect(boundaryValuesFromDescriptor({ kind: "null" })).toEqual([null]);
    expect(boundaryValuesFromDescriptor({ kind: "undefined" })).toEqual([undefined]);
    expect(typeof boundaryValuesFromDescriptor({ kind: "function" })[0]).toBe("function");
    expect(boundaryValuesFromDescriptor({ kind: "react-node" })).toEqual([null, "", "x", 0, 1, false, true]);
    expect(boundaryValuesFromDescriptor({ kind: "array", item: { kind: "literal", value: "x" }, constraints: { minItems: 1, maxItems: 2 } })).toEqual([["x"], ["x", "x"]]);
    expect(boundaryValuesFromDescriptor({ kind: "tuple", items: [{ kind: "literal", value: "a" }, { kind: "literal", value: 1 }] })).toEqual([["a", 1]]);
    expect(boundaryValuesFromDescriptor({ kind: "object", properties: [{ key: "name", optional: false, value: { kind: "literal", value: "ok" } }, { key: "count", optional: true, value: { kind: "literal", value: 1 } }] }).some((value) => !("count" in (value as Record<string, unknown>)))).toBe(true);
    expect(boundaryValuesFromDescriptor({ kind: "union", options: [{ kind: "literal", value: "left" }, { kind: "literal", value: "right" }] })).toEqual(["left", "right"]);
  });
});
