import fc from "fast-check";
import { describe, expect, test } from "vitest";
import * as z from "zod";
import {
  fuzzCommutativeMonoid,
  fuzzMonoid,
  fuzzRoundtrip,
  fuzzValues,
  sampleValuesFromSchema,
} from "ts-fuzzing";
import { xssPayloads } from "ts-fuzzing/security";
import {
  decode,
  empty,
  encode,
  merge,
  urlBundleSchema,
  type UrlBundle,
} from "../src/url-bundle.js";
import { escapeHtml } from "../src/escape.js";

describe("schema-first workflows", () => {
  test("samples values directly from a zod schema", async () => {
    const samples: UrlBundle[] = [];
    for await (const value of sampleValuesFromSchema({
      schema: urlBundleSchema,
      numRuns: 5,
      seed: 1,
    })) {
      samples.push(value as UrlBundle);
    }
    expect(samples.length).toBe(5);
    for (const sample of samples) {
      expect(Array.isArray(sample.items)).toBe(true);
    }
  });

  test("merge is a commutative monoid over UrlBundle (modulo ordering)", async () => {
    await fuzzCommutativeMonoid<UrlBundle>({
      schema: urlBundleSchema,
      numRuns: 30,
      seed: 1,
      identity: empty,
      op: merge,
      equals: (a, b) =>
        a.items.length === b.items.length && a.items.every((entry) => b.items.includes(entry)),
    });
  });

  test("plain string concatenation is a monoid with identity \"\"", async () => {
    const stringSchema = z.object({ s: z.string().max(8) });
    await fuzzMonoid<{ s: string }>({
      schema: stringSchema,
      numRuns: 30,
      seed: 2,
      identity: { s: "" },
      op: (a, b) => ({ s: a.s + b.s }),
    });
  });

  test("JSON encode/decode roundtrips for every generated value", async () => {
    await fuzzRoundtrip<UrlBundle, string>({
      schema: urlBundleSchema,
      numRuns: 50,
      seed: 3,
      encode,
      decode,
    });
  });

  test("XSS corpus surfaces the escape implementation gap", () => {
    let leaks = 0;
    for (let index = 0; index < 30; index += 1) {
      const sample = fc.sample(xssPayloads, { numRuns: 1, seed: index + 1 })[0] ?? "";
      const escaped = escapeHtml(sample);
      if (/javascript:|on\w+=|<\s*script/i.test(escaped)) {
        leaks += 1;
      }
    }
    expect(leaks).toBeGreaterThan(0);
  });

  test("falsy-aware mode reveals a coercion bug in a boolean consumer", async () => {
    const consumer = (input: { force: boolean }) => {
      if (input.force === true) return "force";
      if (input.force === false) return "soft";
      throw new Error(`unexpected value: ${String(input.force)}`);
    };
    let failure: unknown;
    try {
      await fuzzValues<{ force: boolean }>({
        sourcePath: new URL("../src/payload.ts", import.meta.url),
        typeName: "Payload",
        numRuns: 200,
        seed: 1,
        coercion: "falsy-aware",
        run: consumer,
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeDefined();
  });
});
