import fc from "fast-check";
import { arbitraryFromDescriptor } from "./arbitrary.js";
import { serializeValue } from "./fuzz_internal.js";
import {
  emitFuzzWarnings,
  normalizeFuzzValue,
  resolveFuzzData,
  resolveInputDescriptor,
  type SchemaOptions,
  type SourceOptions,
} from "./fuzz_data.js";
import type { ValueRunner } from "./input_fuzz.js";
import { createProgressTracker, type ProgressOptions } from "./progress.js";
import type { StandardSchemaLike } from "./schema.js";

export type MultiFailure<Input> = {
  cause: unknown;
  iteration: number;
  value: Input;
};

export type ValueFuzzMultiReport<Input> = {
  failures: ReadonlyArray<MultiFailure<Input>>;
  iterations: number;
  seed: number | undefined;
  totalRuns: number;
  warnings: string[];
};

export type ValueFuzzMultiOptions<
  Input = unknown,
  Schema extends StandardSchemaLike = StandardSchemaLike,
> = SourceOptions &
  SchemaOptions<Schema> &
  ProgressOptions & {
    maxFailures?: number;
    numRuns?: number;
    run: ValueRunner<Input>;
    seed?: number;
  };

const resolveRun = <Input>(run: ValueRunner<Input>) => {
  if (typeof run === "function") {
    return (value: unknown) => run(value as Input);
  }
  return (value: unknown) => run.run(value as Input);
};

const resolveDescribeInput = <Input>(run: ValueRunner<Input> | undefined) => {
  if (!run || typeof run === "function") {
    return undefined;
  }
  return run.describeInput;
};

const stableKey = (value: unknown) => {
  try {
    return JSON.stringify(serializeValue(value));
  } catch {
    return String(value);
  }
};

export const fuzzValuesMulti = async <Input = unknown>(
  options: ValueFuzzMultiOptions<Input>,
): Promise<ValueFuzzMultiReport<Input>> => {
  const resolved = resolveFuzzData(options);
  emitFuzzWarnings(resolved.warnings);
  const run = resolveRun(options.run);
  const describeInput = resolveDescribeInput(options.run);
  const inputDescriptor = resolveInputDescriptor(resolved.valueDescriptor, describeInput);
  const numRuns = options.numRuns ?? 100;
  const maxFailures = options.maxFailures ?? Number.POSITIVE_INFINITY;

  const baseArbitrary = arbitraryFromDescriptor(inputDescriptor);
  const arbitrary = (
    resolved.schemaSupport
      ? baseArbitrary.filter((value) => resolved.schemaSupport!.normalizeSync(value).ok)
      : baseArbitrary
  ) as fc.Arbitrary<unknown>;

  const sampleOptions: Parameters<typeof fc.sample>[1] = { numRuns };
  if (options.seed !== undefined) {
    sampleOptions.seed = options.seed;
  }
  const samples = fc.sample(arbitrary, sampleOptions);

  const seen = new Set<string>();
  const failures: MultiFailure<Input>[] = [];
  const progress = createProgressTracker(options);
  let iterations = 0;

  for (const candidate of samples) {
    iterations += 1;
    const normalized = normalizeFuzzValue(candidate, resolved.schemaSupport);
    if (!normalized.ok) {
      await progress.tick(iterations, failures.length, numRuns);
      continue;
    }
    try {
      await run(normalized.value);
    } catch (cause) {
      const key = stableKey(normalized.value);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      failures.push({
        cause,
        iteration: iterations,
        value: normalized.value as Input,
      });
      if (failures.length >= maxFailures) {
        break;
      }
    }
    await progress.tick(iterations, failures.length, numRuns);
  }

  await progress.finalize(iterations, failures.length, numRuns);

  return {
    failures,
    iterations,
    seed: options.seed,
    totalRuns: numRuns,
    warnings: resolved.warnings,
  };
};
