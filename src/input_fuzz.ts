import inspector from "node:inspector";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { arbitraryFromDescriptor } from "./arbitrary.js";
import {
  coverageKeysForTarget,
  DeterministicRng,
  generateValue,
  loadCorpus,
  mutateValue,
  saveCorpus,
  type ScriptCoverage,
} from "./fuzz_internal.js";
import {
  emitFuzzWarnings,
  normalizeFuzzValue,
  resolveFuzzData,
  resolveInputDescriptor,
  sampleBoundaryFuzzData,
  type InputDescriptorTransform,
  type SchemaOptions,
  type SourceOptions,
} from "./fuzz_data.js";
import type { StandardSchemaLike } from "./schema.js";

export type ValueRunner<Input = unknown> =
  | ((input: Input) => unknown | Promise<unknown>)
  | {
      describeInput?: InputDescriptorTransform;
      run: (input: Input) => unknown | Promise<unknown>;
    };

export type ValueFuzzOptions<Input = unknown, Schema extends StandardSchemaLike = StandardSchemaLike> = SourceOptions & SchemaOptions<Schema> & {
  numRuns?: number;
  run: ValueRunner<Input>;
  seed?: number;
};

export type GuidedCoverageReport = {
  corpusSize: number;
  discoveries: GuidedCoverageDiscovery[];
  discoveredBlocks: number;
  iterations: number;
  loadedCorpusSize?: number;
  warnings: string[];
};

export type GuidedCoverageDiscovery = {
  input: unknown;
  iteration: number;
  newBlocks: number;
  reason: "coverage" | "failure";
  totalBlocks: number;
};

export type QuickCheckReport = {
  checkedCases: number;
  totalCases: number;
  warnings: string[];
};

export type ValueGuidedFuzzOptions<Input = unknown, Schema extends StandardSchemaLike = StandardSchemaLike> = SourceOptions & SchemaOptions<Schema> & {
  corpusPath?: string | URL;
  initialCorpusSize?: number;
  maxIterations?: number;
  run: ValueRunner<Input>;
  seed?: number;
};

export type ValueQuickCheckOptions<Input = unknown, Schema extends StandardSchemaLike = StandardSchemaLike> = SourceOptions & SchemaOptions<Schema> & {
  maxCases?: number;
  run: ValueRunner<Input>;
};

export class ValueFuzzError extends Error {
  failingValue: unknown;
  seed: number | undefined;
  cause: unknown;
  report: GuidedCoverageReport | QuickCheckReport | undefined;
  warnings: string[];

  constructor(message: string, options: {
    cause: unknown;
    failingValue: unknown;
    report?: GuidedCoverageReport | QuickCheckReport;
    seed?: number;
    warnings?: string[];
  }) {
    super(message, { cause: options.cause });
    this.name = "ValueFuzzError";
    this.cause = options.cause;
    this.failingValue = options.failingValue;
    this.report = options.report;
    this.seed = options.seed;
    this.warnings = options.warnings ?? [];
  }
}

const normalizePath = (sourcePath: string | URL) => {
  if (sourcePath instanceof URL) {
    return fileURLToPath(sourcePath);
  }
  return sourcePath;
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

const inspectorPost = async <Result>(
  session: inspector.Session,
  method: string,
  params?: Record<string, unknown>,
): Promise<Result> => {
  return await new Promise<Result>((resolve, reject) => {
    (session as any).post(method, params ?? {}, (error: Error | null, result: Result) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(result);
    });
  });
};

class CoverageCollector {
  private session = new inspector.Session();

  async start() {
    this.session.connect();
    await inspectorPost(this.session, "Profiler.enable");
    await inspectorPost(this.session, "Profiler.startPreciseCoverage", {
      callCount: true,
      detailed: true,
    });
    await this.reset();
  }

  async reset() {
    await inspectorPost(this.session, "Profiler.takePreciseCoverage");
  }

  async take(): Promise<ScriptCoverage[]> {
    const result = await inspectorPost<{ result: ScriptCoverage[] }>(
      this.session,
      "Profiler.takePreciseCoverage",
    );
    return result.result;
  }

  async stop() {
    try {
      await inspectorPost(this.session, "Profiler.stopPreciseCoverage");
    } finally {
      try {
        await inspectorPost(this.session, "Profiler.disable");
      } finally {
        this.session.disconnect();
      }
    }
  }
}

export const fuzzValues = async <Input = unknown>(
  options: ValueFuzzOptions<Input>,
): Promise<void> => {
  const resolved = resolveFuzzData(options);
  emitFuzzWarnings(resolved.warnings);
  const run = resolveRun(options.run);
  const describeInput = resolveDescribeInput(options.run);
  const inputDescriptor = resolveInputDescriptor(resolved.valueDescriptor, describeInput);
  const arbitrary = (
    resolved.schemaSupport
      ? arbitraryFromDescriptor(inputDescriptor).filter((value) => resolved.schemaSupport!.normalizeSync(value).ok)
      : arbitraryFromDescriptor(inputDescriptor)
  ) as fc.Arbitrary<unknown>;
  let lastValue: unknown;

  try {
    await fc.assert(
      fc.asyncProperty(arbitrary, async (candidate) => {
        const normalized = normalizeFuzzValue(candidate, resolved.schemaSupport);
        if (!normalized.ok) {
          return;
        }
        lastValue = normalized.value;
        await run(normalized.value);
      }),
      {
        endOnFailure: true,
        numRuns: options.numRuns ?? 100,
        seed: options.seed,
      },
    );
  } catch (error) {
    throw new ValueFuzzError("value fuzzing failed", {
      cause: error,
      failingValue: lastValue,
      seed: options.seed,
      warnings: resolved.warnings,
    });
  }
};

export const fuzzValuesGuided = async <Input = unknown>(
  options: ValueGuidedFuzzOptions<Input>,
): Promise<GuidedCoverageReport> => {
  const resolved = resolveFuzzData(options);
  emitFuzzWarnings(resolved.warnings);
  const run = resolveRun(options.run);
  const describeInput = resolveDescribeInput(options.run);
  const inputDescriptor = resolveInputDescriptor(resolved.valueDescriptor, describeInput);
  const rng = new DeterministicRng(options.seed ?? 1);
  const collector = new CoverageCollector();
  const initialCorpusSize = options.initialCorpusSize ?? 8;
  const maxIterations = options.maxIterations ?? 100;
  const corpusPath = options.corpusPath ? normalizePath(options.corpusPath) : undefined;
  const corpus = loadCorpus<unknown>(corpusPath);
  const discoveries: GuidedCoverageDiscovery[] = [];
  const loadedCorpusSize = corpus.length;
  const discoveredBlocks = new Set<string>();
  let completedIterations = 0;

  const recordDiscovery = (entry: Omit<GuidedCoverageDiscovery, "totalBlocks">) => {
    discoveries.push({
      ...entry,
      totalBlocks: discoveredBlocks.size,
    });
    if (discoveries.length > 64) {
      discoveries.shift();
    }
  };

  await collector.start();
  try {
    let attempts = 0;
    while (completedIterations < maxIterations && attempts < maxIterations * 20) {
      attempts += 1;
      const candidate =
        corpus.length === 0 || completedIterations < initialCorpusSize
          ? generateValue(inputDescriptor, rng)
          : mutateValue(rng.pick(corpus), inputDescriptor, rng);

      const normalized = normalizeFuzzValue(candidate, resolved.schemaSupport);
      if (!normalized.ok) {
        continue;
      }
      const value = normalized.value;

      completedIterations += 1;

      await collector.reset();
      try {
        await run(value);
      } catch (error) {
        const coverage = await collector.take();
        const keys = resolved.sourcePath ? coverageKeysForTarget(coverage, resolved.sourcePath) : new Set<string>();
        let newBlocks = 0;
        for (const key of keys) {
          if (!discoveredBlocks.has(key)) {
            discoveredBlocks.add(key);
            newBlocks += 1;
          }
        }
        recordDiscovery({
          input: value,
          iteration: completedIterations,
          newBlocks,
          reason: "failure",
        });
        throw new ValueFuzzError("guided value fuzzing failed", {
          cause: error,
          failingValue: value,
          report: {
            corpusSize: corpus.length,
            discoveries,
            discoveredBlocks: discoveredBlocks.size,
            iterations: completedIterations,
            loadedCorpusSize,
            warnings: resolved.warnings,
          },
          seed: options.seed,
          warnings: resolved.warnings,
        });
      }

      const coverage = await collector.take();
      const keys = resolved.sourcePath ? coverageKeysForTarget(coverage, resolved.sourcePath) : new Set<string>();
      let discoveredNewBlock = false;
      let newBlocks = 0;
      for (const key of keys) {
        if (!discoveredBlocks.has(key)) {
          discoveredNewBlock = true;
          discoveredBlocks.add(key);
          newBlocks += 1;
        }
      }

      if (discoveredNewBlock) {
        recordDiscovery({
          input: value,
          iteration: completedIterations,
          newBlocks,
          reason: "coverage",
        });
      }

      if (discoveredNewBlock || corpus.length < initialCorpusSize) {
        corpus.push(candidate);
        if (corpus.length > 64) {
          corpus.shift();
        }
      }
    }
  } finally {
    saveCorpus(corpusPath, corpus);
    await collector.stop();
  }

  return {
    corpusSize: corpus.length,
    discoveries,
    discoveredBlocks: discoveredBlocks.size,
    iterations: completedIterations,
    loadedCorpusSize,
    warnings: resolved.warnings,
  };
};

export const quickCheckValues = async <Input = unknown>(
  options: ValueQuickCheckOptions<Input>,
): Promise<QuickCheckReport> => {
  const resolved = resolveFuzzData(options);
  emitFuzzWarnings(resolved.warnings);
  const run = resolveRun(options.run);
  const describeInput = resolveDescribeInput(options.run);
  const cases = sampleBoundaryFuzzData(resolved, {
    describeInput,
    maxCases: options.maxCases ?? 64,
  });

  let checkedCases = 0;
  for (const candidate of cases) {
    checkedCases += 1;
    try {
      await run(candidate);
    } catch (error) {
      throw new ValueFuzzError("value quick-check failed", {
        cause: error,
        failingValue: candidate,
        report: {
          checkedCases,
          totalCases: cases.length,
          warnings: resolved.warnings,
        },
        warnings: resolved.warnings,
      });
    }
  }

  return {
    checkedCases,
    totalCases: cases.length,
    warnings: resolved.warnings,
  };
};
