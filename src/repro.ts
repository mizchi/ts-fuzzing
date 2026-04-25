import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ValueFuzzError } from "./input_fuzz.js";

export type ReproRenderOptions = {
  error: ValueFuzzError;
  framework?: "vitest" | "node:test";
  runnerImport?: string;
  runnerSymbol?: string;
  testName?: string;
};

export type ReproWriteOptions = ReproRenderOptions & {
  outputPath: string | URL;
};

const formatLiteral = (value: unknown): string => {
  if (value === undefined) {
    return "undefined";
  }
  if (typeof value === "bigint") {
    return `${value.toString()}n`;
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    return Number.isNaN(value) ? "Number.NaN" : value > 0 ? "Number.POSITIVE_INFINITY" : "Number.NEGATIVE_INFINITY";
  }
  return JSON.stringify(value, null, 2);
};

const resolvePath = (target: string | URL) => {
  if (target instanceof URL) {
    return fileURLToPath(target);
  }
  return target;
};

export const renderReproTest = (options: ReproRenderOptions): string => {
  const { error, framework = "vitest", runnerImport, runnerSymbol = "runCheck", testName } = options;
  const valueLiteral = formatLiteral(error.failingValue);
  const seedComment = error.seed !== undefined ? `  // seed: ${error.seed}\n` : "";
  const displayName = testName ?? `reproduces ts-fuzzing failure${error.seed !== undefined ? ` (seed ${error.seed})` : ""}`;

  const imports: string[] = [];
  if (framework === "vitest") {
    imports.push('import { test } from "vitest";');
  } else {
    imports.push('import { test } from "node:test";');
  }
  if (runnerImport) {
    imports.push(`import { ${runnerSymbol} } from ${JSON.stringify(runnerImport)};`);
  }

  const runnerCall = runnerImport
    ? `  await ${runnerSymbol}(failingValue);`
    : `  // TODO: call your code under test with failingValue\n  void failingValue;`;

  return `${imports.join("\n")}\n\ntest(${JSON.stringify(displayName)}, async () => {\n${seedComment}  const failingValue = ${valueLiteral};\n${runnerCall}\n});\n`;
};

export const writeReproTest = (options: ReproWriteOptions): string => {
  const resolvedPath = path.resolve(resolvePath(options.outputPath));
  const dir = path.dirname(resolvedPath);
  fs.mkdirSync(dir, { recursive: true });
  const contents = renderReproTest(options);
  fs.writeFileSync(resolvedPath, contents);
  return resolvedPath;
};
