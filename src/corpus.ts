import { fileURLToPath } from "node:url";
import { loadCorpus as loadInternal, saveCorpus as saveInternal } from "./fuzz_internal.js";
import { ValueFuzzError, type ValueRunner } from "./input_fuzz.js";
import { createProgressTracker, type ProgressOptions } from "./progress.js";

export type CorpusLocation = {
  corpusPath: string | URL;
};

export type CorpusFailure<Input> = {
  cause: unknown;
  index: number;
  value: Input;
};

export type CorpusReport<Input> = {
  failures: ReadonlyArray<CorpusFailure<Input>>;
  passed: number;
  total: number;
};

export type FuzzFromCorpusOptions<Input = unknown> = CorpusLocation &
  ProgressOptions & {
    collectAllFailures?: boolean;
    run: ValueRunner<Input>;
  };

const normalizePath = (target: string | URL) =>
  target instanceof URL ? fileURLToPath(target) : target;

const resolveRun = <Input>(run: ValueRunner<Input>) => {
  if (typeof run === "function") {
    return (value: unknown) => run(value as Input);
  }
  return (value: unknown) => run.run(value as Input);
};

export const loadCorpus = <Input = unknown>(options: CorpusLocation): Input[] => {
  return loadInternal<Input>(normalizePath(options.corpusPath));
};

export const saveCorpus = <Input = unknown>(
  options: CorpusLocation & { corpus: ReadonlyArray<Input> },
): void => {
  saveInternal(normalizePath(options.corpusPath), Array.from(options.corpus));
};

export const appendToCorpus = <Input = unknown>(
  options: CorpusLocation & { value: Input },
): Input[] => {
  const resolved = normalizePath(options.corpusPath);
  const existing = loadInternal<Input>(resolved);
  existing.push(options.value);
  saveInternal(resolved, existing);
  return loadInternal<Input>(resolved);
};

export const fuzzFromCorpus = async <Input = unknown>(
  options: FuzzFromCorpusOptions<Input>,
): Promise<CorpusReport<Input>> => {
  const resolved = normalizePath(options.corpusPath);
  const corpus = loadInternal<Input>(resolved);
  const run = resolveRun(options.run);
  const failures: CorpusFailure<Input>[] = [];
  const progress = createProgressTracker(options);
  let passed = 0;

  for (let index = 0; index < corpus.length; index++) {
    const value = corpus[index];
    try {
      await run(value);
      passed += 1;
    } catch (cause) {
      failures.push({ cause, index, value });
      if (!options.collectAllFailures) {
        await progress.finalize(index + 1, failures.length, corpus.length);
        throw new ValueFuzzError(`corpus entry ${index} failed`, {
          cause,
          failingValue: value,
        });
      }
    }
    await progress.tick(index + 1, failures.length, corpus.length);
  }

  await progress.finalize(corpus.length, failures.length, corpus.length);

  return {
    failures,
    passed,
    total: corpus.length,
  };
};
