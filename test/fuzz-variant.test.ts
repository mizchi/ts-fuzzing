import { describe, expect, test } from "vitest";
import { fuzzValues } from "../src/index.js";

const sourcePath = new URL("./fixtures/Cmd.ts", import.meta.url);

type Cmd =
  | { kind: "open"; path: string }
  | { kind: "close"; reason: string }
  | { kind: "save"; force: boolean };

describe("variantStrategy", () => {
  test("default (weighted) is not guaranteed to hit every variant", async () => {
    // We don't assert a specific distribution; this test just exercises the
    // default path and asserts the run completes.
    let saw = 0;
    await fuzzValues<Cmd>({
      sourcePath,
      typeName: "Cmd",
      numRuns: 30,
      seed: 1,
      run(cmd) {
        saw += 1;
        expect(["open", "close", "save"]).toContain(cmd.kind);
      },
    });
    expect(saw).toBeGreaterThan(0);
  });

  test("uniform variantStrategy exercises every variant at least once", async () => {
    const seen = new Set<string>();
    await fuzzValues<Cmd>({
      sourcePath,
      typeName: "Cmd",
      numRuns: 30,
      seed: 1,
      variantStrategy: "uniform",
      run(cmd) {
        seen.add(cmd.kind);
      },
    });
    expect(seen).toEqual(new Set(["open", "close", "save"]));
  });

  test("uniform distributes numRuns evenly across variants", async () => {
    const counts: Record<string, number> = { open: 0, close: 0, save: 0 };
    await fuzzValues<Cmd>({
      sourcePath,
      typeName: "Cmd",
      numRuns: 30,
      seed: 1,
      variantStrategy: "uniform",
      run(cmd) {
        counts[cmd.kind] += 1;
      },
    });
    // 30 / 3 = 10 per variant
    expect(counts.open).toBe(10);
    expect(counts.close).toBe(10);
    expect(counts.save).toBe(10);
  });
});
