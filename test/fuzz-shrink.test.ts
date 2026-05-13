import { describe, expect, test } from "vitest";
import * as z from "zod";
import { shrinkValue } from "../src/index.js";

describe("shrinkValue", () => {
  test("returns the original when the value does not fail", async () => {
    const result = await shrinkValue<number>({
      value: 0,
      run() {
        /* never throws */
      },
    });
    expect(result.minimizedValue).toBe(0);
    expect(result.accepted).toBe(0);
    expect(result.warnings.some((entry) => entry.includes("did not fail"))).toBe(true);
  });

  test("shrinks an array down to the minimal failing prefix", async () => {
    const result = await shrinkValue<number[]>({
      value: [1, 2, 3, 99, 4, 5],
      run(input) {
        if (input.includes(99)) {
          throw new Error("contains 99");
        }
      },
    });
    expect(result.minimizedValue).toEqual([99]);
    expect(result.attempts).toBeGreaterThan(0);
    expect(result.accepted).toBeGreaterThan(0);
  });

  test("shrinks objects by dropping unrelated keys", async () => {
    const result = await shrinkValue<{ name: string; level: number; extra: string }>({
      value: { name: "alice", level: 13, extra: "ignored" },
      run({ level }) {
        if (level === 13) {
          throw new Error("unlucky level");
        }
      },
    });
    expect(result.minimizedValue.level).toBe(13);
    expect("name" in result.minimizedValue).toBe(false);
    expect("extra" in result.minimizedValue).toBe(false);
  });

  test("shrinks strings to a minimal failing fragment", async () => {
    const result = await shrinkValue<string>({
      value: "abXcdefghi",
      run(value) {
        if (value.includes("X")) {
          throw new Error("contains X");
        }
      },
    });
    expect(result.minimizedValue.includes("X")).toBe(true);
    expect(result.minimizedValue.length).toBeLessThan("abXcdefghi".length);
  });

  test("shrinks numbers toward zero while preserving the failure", async () => {
    const result = await shrinkValue<number>({
      value: 1234,
      run(value) {
        if (value > 100) {
          throw new Error("too big");
        }
      },
    });
    expect(result.minimizedValue).toBeGreaterThan(100);
    expect(result.minimizedValue).toBeLessThan(1234);
  });

  test("only accepts candidates with the same failure signature", async () => {
    const result = await shrinkValue<{ value: number }>({
      value: { value: 999 },
      failureSignature: (cause) => (cause instanceof Error ? cause.message : String(cause)),
      run({ value }) {
        if (value > 500) {
          throw new Error("too large");
        }
        if (value < -500) {
          // a different failure signature — should NOT be accepted as a shrink
          throw new Error("too small");
        }
      },
    });
    expect(result.minimizedValue.value).toBeGreaterThan(500);
  });

  test("honors schema normalization when reducing", async () => {
    const schema = z.object({ n: z.number().int().min(0).max(100) });
    type Input = z.infer<typeof schema>;
    const result = await shrinkValue<Input>({
      schema,
      value: { n: 77 },
      run({ n }) {
        if (n >= 50) {
          throw new Error("threshold");
        }
      },
    });
    expect(result.minimizedValue.n).toBeGreaterThanOrEqual(50);
    expect(result.minimizedValue.n).toBeLessThanOrEqual(100);
  });

  test("passes the schema-normalized value to run, not the raw candidate", async () => {
    // The schema strips extra keys when normalizing, so the runner should see
    // only the declared keys even if the candidate (or the original value)
    // carries extra ones.
    const schema = z.object({ n: z.number().int().min(0).max(100) }).strip();
    type Input = z.infer<typeof schema>;
    const observed: Array<Record<string, unknown>> = [];
    await shrinkValue<Input>({
      schema,
      value: { n: 77, extraKey: "leak" } as unknown as Input,
      maxAttempts: 8,
      run(value) {
        observed.push(value as Record<string, unknown>);
        if ((value as Input).n >= 50) {
          throw new Error("threshold");
        }
      },
    });
    expect(observed.length).toBeGreaterThan(0);
    for (const seen of observed) {
      expect("extraKey" in seen).toBe(false);
    }
  });

  test("respects maxAttempts as a CI safety net", async () => {
    const result = await shrinkValue<number[]>({
      value: Array.from({ length: 30 }, (_unused, index) => index),
      maxAttempts: 4,
      run(input) {
        if (input.length > 0) {
          throw new Error("non-empty");
        }
      },
    });
    expect(result.attempts).toBeLessThanOrEqual(4);
  });
});
