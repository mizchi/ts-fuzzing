import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, test } from "vitest";

const cliPath = fileURLToPath(new URL("../bin/ts-fuzzing.mjs", import.meta.url));
const repoRoot = path.dirname(path.dirname(cliPath));

const fixturePath = (relative: string) => path.join(repoRoot, "test", "fixtures", relative);

describe("ts-fuzzing CLI", () => {
  test("prints usage when invoked without args", () => {
    let exitCode = 0;
    let stdout = "";
    try {
      execFileSync(process.execPath, [cliPath], { encoding: "utf8" });
    } catch (error) {
      const err = error as { status: number; stderr: string; stdout: string };
      exitCode = err.status;
      stdout = err.stdout ?? "";
    }
    expect(exitCode).toBe(1);
    expect(stdout).toMatch(/Usage:/);
  });

  test("replays a seed against a runner and reports zero failures for a no-op runner", () => {
    const output = execFileSync(
      process.execPath,
      [
        cliPath,
        "replay",
        "--seed",
        "1",
        "--source",
        fixturePath("replay-target.ts"),
        "--type",
        "ReplayInput",
        "--runner",
        fixturePath("replay-runner.mjs"),
        "--symbol",
        "run",
        "--num-runs",
        "5",
        "--json",
      ],
      { encoding: "utf8" },
    );
    const report = JSON.parse(output);
    expect(report.seed).toBe(1);
    expect(report.iterations.length).toBeGreaterThan(0);
    expect(report.failures.length).toBe(0);
  });

  test("exits with non-zero status when the runner throws", () => {
    let exitCode = 0;
    let output = "";
    try {
      execFileSync(
        process.execPath,
        [
          cliPath,
          "replay",
          "--seed",
          "1",
          "--source",
          fixturePath("replay-target.ts"),
          "--type",
          "ReplayInput",
          "--runner",
          fixturePath("replay-runner-fail.mjs"),
          "--symbol",
          "run",
          "--num-runs",
          "3",
          "--json",
        ],
        { encoding: "utf8" },
      );
    } catch (error) {
      const err = error as { status: number; stdout: string };
      exitCode = err.status;
      output = err.stdout ?? "";
    }
    expect(exitCode).toBe(1);
    const report = JSON.parse(output);
    expect(report.failures.length).toBeGreaterThan(0);
  });
});
