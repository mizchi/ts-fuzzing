import { fileURLToPath } from "node:url";
import {
  DeterministicRng,
  loadCorpus as loadInternal,
  mutateValue as mutateInternal,
} from "./fuzz_internal.js";
import {
  emitFuzzWarnings,
  resolveFuzzData,
  resolveInputDescriptor,
  type SchemaOptions,
  type SourceOptions,
} from "./fuzz_data.js";
import { ValueFuzzError, type ValueRunner } from "./input_fuzz.js";
import type { CorpusLocation } from "./corpus.js";
import type { StandardSchemaLike } from "./schema.js";

export type MutateValueOptions<
  Schema extends StandardSchemaLike = StandardSchemaLike,
> = SourceOptions &
  SchemaOptions<Schema> & {
    seed?: number;
    value: unknown;
  };

export type GenerateMutationsOptions<
  Schema extends StandardSchemaLike = StandardSchemaLike,
> = SourceOptions &
  SchemaOptions<Schema> & {
    count: number;
    seed?: number;
    value: unknown;
  };

export type CorpusMutationFailure<Input> = {
  cause: unknown;
  mutation: Input;
  origin: Input;
  originIndex: number;
};

export type CorpusMutationReport<Input> = {
  attempts: number;
  failures: ReadonlyArray<CorpusMutationFailure<Input>>;
  passed: number;
  totalEntries: number;
};

export type FuzzFromCorpusWithMutationOptions<
  Input = unknown,
  Schema extends StandardSchemaLike = StandardSchemaLike,
> = CorpusLocation &
  SourceOptions &
  SchemaOptions<Schema> & {
    collectAllFailures?: boolean;
    mutationsPerEntry?: number;
    run: ValueRunner<Input>;
    seed?: number;
  };

const normalizePath = (target: string | URL) =>
  target instanceof URL ? fileURLToPath(target) : target;

const resolveRun = <Input>(run: ValueRunner<Input>) => {
  if (typeof run === "function") {
    return (value: unknown) => run(value as Input);
  }
  return (value: unknown) => run.run(value as Input);
};

const resolveDescriptor = <Schema extends StandardSchemaLike>(
  options: SourceOptions & SchemaOptions<Schema>,
) => {
  const resolved = resolveFuzzData(options);
  emitFuzzWarnings(resolved.warnings);
  const descriptor = resolveInputDescriptor(resolved.valueDescriptor, undefined);
  return { descriptor, warnings: resolved.warnings };
};

export const mutateValue = <Input = unknown>(options: MutateValueOptions): Input => {
  const { descriptor } = resolveDescriptor(options);
  const rng = new DeterministicRng(options.seed ?? (Date.now() >>> 0));
  return mutateInternal(options.value, descriptor, rng) as Input;
};

export const generateMutations = <Input = unknown>(
  options: GenerateMutationsOptions,
): Input[] => {
  if (options.count <= 0) {
    return [];
  }
  const { descriptor } = resolveDescriptor(options);
  const rng = new DeterministicRng(options.seed ?? (Date.now() >>> 0));
  const mutations: Input[] = [];
  for (let index = 0; index < options.count; index += 1) {
    mutations.push(mutateInternal(options.value, descriptor, rng) as Input);
  }
  return mutations;
};

export const fuzzFromCorpusWithMutation = async <Input = unknown>(
  options: FuzzFromCorpusWithMutationOptions<Input>,
): Promise<CorpusMutationReport<Input>> => {
  const resolved = normalizePath(options.corpusPath);
  const corpus = loadInternal<Input>(resolved);
  const { descriptor } = resolveDescriptor(options);
  const rng = new DeterministicRng(options.seed ?? (Date.now() >>> 0));
  const run = resolveRun(options.run);
  const mutationsPerEntry = options.mutationsPerEntry ?? 8;

  const failures: CorpusMutationFailure<Input>[] = [];
  let passed = 0;
  let attempts = 0;

  for (let originIndex = 0; originIndex < corpus.length; originIndex += 1) {
    const origin = corpus[originIndex];
    for (let mutationIndex = 0; mutationIndex < mutationsPerEntry; mutationIndex += 1) {
      const mutation = mutateInternal(origin, descriptor, rng) as Input;
      attempts += 1;
      try {
        await run(mutation);
        passed += 1;
      } catch (cause) {
        failures.push({
          cause,
          mutation,
          origin,
          originIndex,
        });
        if (!options.collectAllFailures) {
          throw new ValueFuzzError(
            `corpus mutation failed on entry ${originIndex}`,
            {
              cause,
              failingValue: mutation,
            },
          );
        }
      }
    }
  }

  return {
    attempts,
    failures,
    passed,
    totalEntries: corpus.length,
  };
};
