import fc from "fast-check";
import { arbitraryFromDescriptor } from "./arbitrary.js";
import {
  emitFuzzWarnings,
  normalizeFuzzValue,
  resolveFuzzData,
  resolveInputDescriptor,
  type SchemaOptions,
  type SourceOptions,
} from "./fuzz_data.js";
import { ValueFuzzError, type ValueRunner } from "./input_fuzz.js";
import type { StandardSchemaLike } from "./schema.js";

export type ReplayIteration<Input> = {
  cause?: unknown;
  failed: boolean;
  iteration: number;
  skipped?: boolean;
  value: Input;
};

export type ReplayReport<Input> = {
  failures: ReadonlyArray<ReplayIteration<Input>>;
  iterations: ReadonlyArray<ReplayIteration<Input>>;
  seed: number;
  totalRuns: number;
  warnings: string[];
};

export type ReplayValuesOptions<
  Input = unknown,
  Schema extends StandardSchemaLike = StandardSchemaLike,
> = SourceOptions &
  SchemaOptions<Schema> & {
    numRuns?: number;
    onIteration?: (step: ReplayIteration<Input>) => void | Promise<void>;
    run?: ValueRunner<Input>;
    seed: number;
    stopOnFirstFailure?: boolean;
  };

export type ReplayFromErrorOptions<
  Input = unknown,
  Schema extends StandardSchemaLike = StandardSchemaLike,
> = Omit<ReplayValuesOptions<Input, Schema>, "seed"> & {
  error: ValueFuzzError;
};

const resolveRun = <Input>(run: ValueRunner<Input> | undefined) => {
  if (!run) {
    return undefined;
  }
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

export const replayValues = async <Input = unknown>(
  options: ReplayValuesOptions<Input>,
): Promise<ReplayReport<Input>> => {
  const resolved = resolveFuzzData(options);
  emitFuzzWarnings(resolved.warnings);
  const describeInput = resolveDescribeInput(options.run);
  const descriptor = resolveInputDescriptor(resolved.valueDescriptor, describeInput);
  const base = arbitraryFromDescriptor(descriptor);
  const arbitrary = (
    resolved.schemaSupport
      ? base.filter((value) => resolved.schemaSupport!.normalizeSync(value).ok)
      : base
  ) as fc.Arbitrary<unknown>;

  const numRuns = options.numRuns ?? 100;
  const samples = fc.sample(arbitrary, { numRuns, seed: options.seed });
  const run = resolveRun(options.run);

  const iterations: ReplayIteration<Input>[] = [];
  const failures: ReplayIteration<Input>[] = [];

  for (let index = 0; index < samples.length; index += 1) {
    const candidate = samples[index];
    const normalized = normalizeFuzzValue(candidate, resolved.schemaSupport);
    if (!normalized.ok) {
      const skipped: ReplayIteration<Input> = {
        failed: false,
        iteration: index + 1,
        skipped: true,
        value: candidate as Input,
      };
      iterations.push(skipped);
      if (options.onIteration) {
        await options.onIteration(skipped);
      }
      continue;
    }

    const entry: ReplayIteration<Input> = {
      failed: false,
      iteration: index + 1,
      value: normalized.value as Input,
    };

    if (run) {
      try {
        await run(normalized.value);
      } catch (cause) {
        entry.failed = true;
        entry.cause = cause;
        failures.push(entry);
      }
    }

    iterations.push(entry);
    if (options.onIteration) {
      await options.onIteration(entry);
    }

    if (entry.failed && options.stopOnFirstFailure) {
      break;
    }
  }

  return {
    failures,
    iterations,
    seed: options.seed,
    totalRuns: numRuns,
    warnings: resolved.warnings,
  };
};

export const replayFromError = async <Input = unknown>(
  options: ReplayFromErrorOptions<Input>,
): Promise<ReplayReport<Input>> => {
  const { error, ...rest } = options;
  if (error.seed === undefined) {
    throw new Error("replayFromError requires a ValueFuzzError that carries a seed");
  }
  return await replayValues<Input>({
    ...(rest as ReplayValuesOptions<Input>),
    seed: error.seed,
  });
};
