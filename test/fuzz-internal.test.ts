import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { TypeDescriptor } from "../src/descriptor.js";
import {
  clampBounds,
  clampLengths,
  coverageKeysForTarget,
  deserializeValue,
  DeterministicRng,
  generateString,
  generateUnknown,
  generateValue,
  loadCorpus,
  matchesDescriptor,
  mutateObject,
  mutateString,
  mutateValue,
  saveCorpus,
  serializeValue,
  type ScriptCoverage,
} from "../src/fuzz_internal.js";

const tempDirs: string[] = [];
type FakeRng = Pick<DeterministicRng, "bool" | "float" | "int" | "pick">;

const makeTempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-fuzzing-"));
  tempDirs.push(dir);
  return dir;
};

const fakeRng = (overrides: Partial<FakeRng> = {}) =>
  ({
    bool: () => false,
    float: () => 0.25,
    int: (_min: number, max: number) => max,
    pick: <T>(values: readonly T[]) => values[0]!,
    ...overrides,
  }) as DeterministicRng;

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { force: true, recursive: true });
  }
});

describe("fuzz internal helpers", () => {
  test("serializes and restores corpus values with special markers", () => {
    const serialized = serializeValue({
      array: [1, undefined, () => "x"],
      bool: true,
      endpoint: new URL("https://example.com/"),
      lookup: new Map([["x", 1]]),
      nested: { value: null },
      tags: new Set(["a"]),
      text: "ok",
    });

    expect(serialized).toEqual({
      array: [1, { __tsFuzzingType: "undefined" }, { __tsFuzzingType: "function" }],
      bool: true,
      endpoint: { __tsFuzzingType: "url", value: "https://example.com/" },
      lookup: { __tsFuzzingType: "map", entries: [["x", 1]] },
      nested: { value: null },
      tags: { __tsFuzzingType: "set", values: ["a"] },
      text: "ok",
    });

    const restored = deserializeValue(serialized) as Record<string, unknown>;
    expect(restored.bool).toBe(true);
    expect(restored.endpoint).toBeInstanceOf(URL);
    expect(restored.lookup).toBeInstanceOf(Map);
    expect(restored.text).toBe("ok");
    expect(restored.nested).toEqual({ value: null });
    expect(restored.tags).toBeInstanceOf(Set);
    expect(Array.isArray(restored.array)).toBe(true);
    expect((restored.array as unknown[])[1]).toBeUndefined();
    expect(typeof (restored.array as unknown[])[2]).toBe("function");
  });

  test("saves and loads corpus with dedupe", () => {
    const dir = makeTempDir();
    const corpusPath = path.join(dir, "corpus.json");

    saveCorpus(corpusPath, [
      { value: 1 },
      { value: 1 },
      { fn: () => undefined, missing: undefined },
    ]);

    const loaded = loadCorpus<Record<string, unknown>>(corpusPath);
    expect(loaded).toHaveLength(2);
    expect(loaded[0]).toEqual({ value: 1 });
    expect(typeof loaded[1]?.fn).toBe("function");
    expect(loaded[1]?.missing).toBeUndefined();
  });

  test("ignores saveCorpus calls without a target path", () => {
    expect(() =>
      saveCorpus(undefined, [
        { value: 1 },
      ]),
    ).not.toThrow();
  });

  test("returns empty corpus for missing or invalid files", () => {
    const dir = makeTempDir();
    const missingPath = path.join(dir, "missing.json");
    const invalidPath = path.join(dir, "invalid.json");
    fs.writeFileSync(invalidPath, JSON.stringify({ nope: true }));

    expect(loadCorpus(missingPath)).toEqual([]);
    expect(loadCorpus(invalidPath)).toEqual([]);
  });

  test("deterministic rng helpers stay within bounds", () => {
    const rng = new DeterministicRng(1);
    expect(rng.float()).toBeGreaterThanOrEqual(0);
    expect(rng.float()).toBeLessThan(1);
    expect(rng.int(4, 2)).toBe(4);
    expect(typeof rng.bool(1)).toBe("boolean");
    expect(rng.pick(["a", "b", "c"])).toMatch(/[abc]/);
  });

  test("clamps numeric bounds and lengths", () => {
    expect(clampBounds({ max: 1, min: 5 }, [-1, 1])).toEqual([1, 5]);
    expect(clampLengths({ maxLength: 2, minLength: 4 }, [0, 8], ["minLength", "maxLength"])).toEqual([2, 4]);
  });

  test("generates strings for special patterns", () => {
    expect(generateString({ pattern: ".+" }, fakeRng({ int: () => 1 }))).toHaveLength(1);
    expect(generateString({ pattern: "email" }, fakeRng())).toContain("@");
    expect(generateString({ pattern: "url" }, fakeRng())).toContain("://");
    expect(generateString({ pattern: "a+" }, fakeRng({ int: () => 1 }))).toContain("a");
    expect(generateString({ pattern: "[A-Z]{2}" }, fakeRng({ int: () => 1 }))).toMatch(/[A-Z]{2}/);
  });

  test("covers unknown generation branches", () => {
    expect(generateUnknown(fakeRng({ int: () => 0 }))).toBeNull();
    expect(typeof generateUnknown(fakeRng({ int: () => 1, bool: () => true }))).toBe("boolean");
    expect(typeof generateUnknown(fakeRng({ int: () => 2 }))).toBe("number");
    expect(typeof generateUnknown(fakeRng({ int: () => 3 }))).toBe("string");
    expect(Array.isArray(generateUnknown(fakeRng({ int: () => 4 })))).toBe(true);
    expect(generateUnknown(fakeRng({ int: () => 5 }))).toHaveProperty("id");
  });

  test("generates values for all descriptor kinds", () => {
    const descriptors: TypeDescriptor[] = [
      { kind: "unknown" },
      { kind: "string", constraints: { minLength: 1, maxLength: 1 } },
      { kind: "number", integer: true, constraints: { min: 1, max: 1 } },
      { kind: "boolean" },
      { kind: "literal", value: "x" },
      { kind: "null" },
      { kind: "undefined" },
      { kind: "function" },
      { kind: "react-node" },
      { kind: "url" },
      { kind: "map", key: { kind: "literal", value: "x" }, value: { kind: "literal", value: 1 } },
      { kind: "set", item: { kind: "literal", value: "x" } },
      { kind: "array", item: { kind: "literal", value: 1 }, constraints: { minItems: 1, maxItems: 1 } },
      { kind: "tuple", items: [{ kind: "literal", value: "a" }, { kind: "literal", value: 1 }] },
      { kind: "object", properties: [{ key: "name", optional: false, value: { kind: "literal", value: "ok" } }] },
      { kind: "union", options: [{ kind: "literal", value: "left" }, { kind: "literal", value: "right" }] },
    ];

    const values = descriptors.map((descriptor) => generateValue(descriptor, fakeRng({ int: () => 1, bool: () => true })));
    expect(String(values[1])).toHaveLength(1);
    expect(values[2]).toBe(1);
    expect(typeof values[3]).toBe("boolean");
    expect(values[4]).toBe("x");
    expect(values[5]).toBeNull();
    expect(values[6]).toBeUndefined();
    expect(typeof values[7]).toBe("function");
    expect(values[9]).toBeInstanceOf(URL);
    expect(values[10]).toBeInstanceOf(Map);
    expect(values[11]).toBeInstanceOf(Set);
    expect(Array.isArray(values[12])).toBe(true);
    expect(values[13]).toEqual(["a", 1]);
    expect(values[14]).toEqual({ name: "ok" });
    expect(["left", "right"]).toContain(values[15]);

    const floatValue = generateValue(
      { kind: "number", integer: false, constraints: { min: 1, max: 1 } },
      fakeRng({ float: () => 0.5, int: () => 1 }),
    );
    expect(floatValue).toBe(1.5);

    const objectValue = generateValue(
      {
        kind: "object",
        properties: [{ key: "optional", optional: true, value: { kind: "literal", value: "ok" } }],
      },
      fakeRng({ bool: () => true }),
    );
    expect(objectValue).toEqual({});
  });

  test("matches descriptors across runtime shapes", () => {
    expect(matchesDescriptor("x", { kind: "unknown" })).toBe(true);
    expect(matchesDescriptor("x", { kind: "string" })).toBe(true);
    expect(matchesDescriptor(1, { kind: "number", integer: true })).toBe(true);
    expect(matchesDescriptor(false, { kind: "boolean" })).toBe(true);
    expect(matchesDescriptor("x", { kind: "literal", value: "x" })).toBe(true);
    expect(matchesDescriptor(null, { kind: "null" })).toBe(true);
    expect(matchesDescriptor(undefined, { kind: "undefined" })).toBe(true);
    expect(matchesDescriptor(() => undefined, { kind: "function" })).toBe(true);
    expect(matchesDescriptor(1, { kind: "react-node" })).toBe(true);
    expect(matchesDescriptor(new URL("https://example.com/"), { kind: "url" })).toBe(true);
    expect(matchesDescriptor(new Map([["x", 1]]), { kind: "map", key: { kind: "string" }, value: { kind: "number", integer: true } })).toBe(true);
    expect(matchesDescriptor(new Set(["x"]), { kind: "set", item: { kind: "string" } })).toBe(true);
    expect(matchesDescriptor([], { kind: "array", item: { kind: "unknown" } })).toBe(true);
    expect(matchesDescriptor([1], { kind: "tuple", items: [{ kind: "number", integer: true }] })).toBe(true);
    expect(matchesDescriptor({ ok: true }, { kind: "object", properties: [] })).toBe(true);
    expect(matchesDescriptor("x", { kind: "union", options: [{ kind: "literal", value: "x" }] })).toBe(true);
  });

  test("mutates strings across supported operations", () => {
    expect(mutateString("ab", { minLength: 1, maxLength: 4 }, fakeRng({ pick: (values) => values[0]!, int: () => 3 }))).toHaveLength(3);
    expect(mutateString("ab", { minLength: 1 }, fakeRng({ pick: (values) => values[1]! }))).toBe("a");
    expect(mutateString("ab", {}, fakeRng({ pick: (values) => values[2]!, int: () => 1 }))).toMatch(/^a.$/);
    expect(mutateString("ab", {}, fakeRng({ pick: (values) => values[3]!, int: () => 1 }))).not.toBe("");
    expect(mutateString("", { minLength: 1 }, fakeRng({ pick: (values) => values[1]! }))).not.toBe("");
    expect(mutateString("", {}, fakeRng({ pick: (values) => values[2]!, int: () => 1 }))).not.toBe("");
  });

  test("mutates objects and fills required properties", () => {
    const descriptor: TypeDescriptor = {
      kind: "object",
      properties: [
        { key: "required", optional: false, value: { kind: "literal", value: "ok" } },
        { key: "optional", optional: true, value: { kind: "literal", value: "x" } },
      ],
    };

    const removed = mutateObject(
      { required: "ok", optional: "x" },
      descriptor,
      fakeRng({ bool: () => true, pick: (values) => values[1]! }),
    );
    expect(removed).toEqual({ required: "ok" });

    const refilled = mutateObject(
      { optional: "x" },
      descriptor,
      fakeRng({ bool: () => false, pick: (values) => values[0]! }),
    );
    expect(refilled.required).toBe("ok");
  });

  test("mutates values across descriptor kinds", () => {
    expect(mutateValue("x", { kind: "string" }, fakeRng({ pick: (values) => values[2]!, int: () => 1 }))).not.toBe("x");
    expect(mutateValue(1, { kind: "number", integer: true, constraints: { min: 0, max: 2 } }, fakeRng({ pick: (values) => values[1]! }))).toBe(2);
    expect(mutateValue(1, { kind: "number", integer: false, constraints: { min: 0, max: 2 } }, fakeRng({ bool: () => true }))).toBe(1.5);
    expect(mutateValue(false, { kind: "boolean" }, fakeRng())).toBe(true);
    expect(mutateValue("x", { kind: "literal", value: "x" }, fakeRng())).toBe("x");
    expect(mutateValue("x", { kind: "null" }, fakeRng())).toBeNull();
    expect(mutateValue("x", { kind: "undefined" }, fakeRng())).toBeUndefined();
    const fn = () => undefined;
    expect(mutateValue(fn, { kind: "function" }, fakeRng())).toBe(fn);
    expect(mutateValue("x", { kind: "react-node" }, fakeRng())).not.toBeUndefined();
    expect(mutateValue(new URL("https://example.com/"), { kind: "url" }, fakeRng())).toBeInstanceOf(URL);
    expect(mutateValue(new Map([["x", 1]]), { kind: "map", key: { kind: "string" }, value: { kind: "number", integer: true } }, fakeRng())).toBeInstanceOf(Map);
    expect(mutateValue(new Set(["x"]), { kind: "set", item: { kind: "string" } }, fakeRng())).toBeInstanceOf(Set);
    expect(mutateValue([], { kind: "array", item: { kind: "literal", value: 1 } }, fakeRng())).toEqual([1]);
    expect(
      mutateValue([1], { kind: "array", item: { kind: "literal", value: 1 }, constraints: { maxItems: 2 } }, fakeRng({ pick: (values) => values[1]! })),
    ).toEqual([1, 1]);
    expect(
      mutateValue([1, 1], { kind: "array", item: { kind: "literal", value: 1 }, constraints: { minItems: 0, maxItems: 2 } }, fakeRng({ pick: (values) => values[2]! })),
    ).toEqual([1]);
    expect(
      mutateValue([1], { kind: "array", item: { kind: "literal", value: 1 }, constraints: { minItems: 1, maxItems: 2 } }, fakeRng({ pick: (values) => values[2]! })),
    ).toEqual([1]);
    expect(
      mutateValue([1, 1], { kind: "array", item: { kind: "literal", value: 1 }, constraints: { minItems: 0, maxItems: 2 } }, fakeRng({ pick: (values) => values[0]!, int: () => 0 })),
    ).toEqual([1, 1]);
    expect(
      mutateValue(["a", 1], { kind: "tuple", items: [{ kind: "literal", value: "a" }, { kind: "literal", value: 1 }] }, fakeRng()),
    ).toEqual(["a", 1]);
    expect(
      mutateValue({ optional: "x" }, {
        kind: "object",
        properties: [
          { key: "required", optional: false, value: { kind: "literal", value: "ok" } },
          { key: "optional", optional: true, value: { kind: "literal", value: "x" } },
        ],
      }, fakeRng({ bool: () => false, pick: (values) => values[0]! })),
    ).toEqual({ optional: "x", required: "ok" });
    expect(
      mutateValue("x", { kind: "union", options: [{ kind: "literal", value: "x" }, { kind: "literal", value: "y" }] }, fakeRng()),
    ).toBe("x");
    expect(String(mutateValue(1, { kind: "string" }, fakeRng({ int: () => 1 })))).toHaveLength(1);
  });

  test("extracts coverage keys for a matching target only", () => {
    const targetPath = path.join(makeTempDir(), "target.ts");
    const coverage: ScriptCoverage[] = [
      {
        url: `file://${targetPath}`,
        functions: [{ functionName: "f", ranges: [{ count: 1, endOffset: 5, startOffset: 1 }, { count: 0, endOffset: 9, startOffset: 6 }] }],
      },
      {
        url: "/tmp/other.ts",
        functions: [{ functionName: "g", ranges: [{ count: 3, endOffset: 4, startOffset: 2 }] }],
      },
    ];

    expect([...coverageKeysForTarget(coverage, targetPath)]).toEqual([`file://${targetPath}:1-5`]);
  });
});
