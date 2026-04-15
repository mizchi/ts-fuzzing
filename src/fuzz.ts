import inspector from "node:inspector";
import { fileURLToPath } from "node:url";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import fc from "fast-check";
import type * as React from "react";
import { analyzePropsDescriptor } from "./analyzer.js";
import { arbitraryFromDescriptor } from "./arbitrary.js";
import { boundaryValuesFromDescriptor } from "./boundary.js";
import type { TypeDescriptor } from "./descriptor.js";
import {
  coverageKeysForTarget,
  DeterministicRng,
  generateValue,
  loadCorpus,
  mutateValue,
  saveCorpus,
  type ScriptCoverage,
} from "./fuzz_internal.js";
import type { StandardSchemaLike } from "./schema.js";
import { schemaSupportFromSchema } from "./schema.js";

type SchemaInput<Schema extends StandardSchemaLike> = StandardSchemaV1.InferInput<Schema>;
type SchemaOutput<Schema extends StandardSchemaLike> = StandardSchemaV1.InferOutput<Schema>;

export type SourceOptions = {
  sourcePath?: string | URL;
  exportName?: string;
  propsTypeName?: string;
};

export type SchemaOptions<Schema extends StandardSchemaLike = StandardSchemaLike> = {
  schema?: Schema;
};

export type ComponentRenderStrategy<Component, Input = unknown> =
  | ((input: Input) => unknown | Promise<unknown>)
  | {
      describeInput?: (componentPropsDescriptor: TypeDescriptor) => TypeDescriptor;
      render: (component: Component, input: unknown) => unknown | Promise<unknown>;
    };

export type ComponentFuzzOptions<Component, Input = unknown, Schema extends StandardSchemaLike = StandardSchemaLike> = SourceOptions & SchemaOptions<Schema> & {
  component: Component;
  numRuns?: number;
  render: ComponentRenderStrategy<Component, Input>;
  seed?: number;
};

export type GuidedCoverageReport = {
  corpusSize: number;
  discoveries: GuidedCoverageDiscovery[];
  discoveredBlocks: number;
  iterations: number;
  loadedCorpusSize?: number;
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
};

export type ComponentGuidedFuzzOptions<Component, Input = unknown, Schema extends StandardSchemaLike = StandardSchemaLike> = SourceOptions & SchemaOptions<Schema> & {
  component: Component;
  corpusPath?: string | URL;
  initialCorpusSize?: number;
  maxIterations?: number;
  render: ComponentRenderStrategy<Component, Input>;
  seed?: number;
};

export type ComponentQuickCheckOptions<Component, Input = unknown, Schema extends StandardSchemaLike = StandardSchemaLike> = SourceOptions & SchemaOptions<Schema> & {
  component: Component;
  maxCases?: number;
  render: ComponentRenderStrategy<Component, Input>;
};

export class ComponentFuzzError extends Error {
  failingProps: unknown;
  seed: number | undefined;
  cause: unknown;
  report: GuidedCoverageReport | QuickCheckReport | undefined;

  constructor(message: string, options: {
    cause: unknown;
    failingProps: unknown;
    report?: GuidedCoverageReport | QuickCheckReport;
    seed?: number;
  }) {
    super(message, { cause: options.cause });
    this.name = "ComponentFuzzError";
    this.cause = options.cause;
    this.failingProps = options.failingProps;
    this.report = options.report;
    this.seed = options.seed;
  }
}

export class ReactComponentFuzzError extends ComponentFuzzError {
  constructor(message: string, options: {
    cause: unknown;
    failingProps: unknown;
    report?: GuidedCoverageReport | QuickCheckReport;
    seed?: number;
  }) {
    super(message, options);
    this.name = "ReactComponentFuzzError";
  }
}

const normalizePath = (sourcePath: string | URL) => {
  if (sourcePath instanceof URL) {
    return fileURLToPath(sourcePath);
  }
  return sourcePath;
};

const resolveRender = <Component, Input>(
  component: Component,
  render: ComponentRenderStrategy<Component, Input>,
) => {
  if (typeof render === "function") {
    return (props: unknown) => render(props as Input);
  }
  return (props: unknown) => render.render(component, props);
};

const resolveInputDescriptor = <Component, Input>(
  componentPropsDescriptor: TypeDescriptor,
  render: ComponentRenderStrategy<Component, Input> | undefined,
) => {
  if (!render || typeof render === "function" || !render.describeInput) {
    return componentPropsDescriptor;
  }
  return render.describeInput(componentPropsDescriptor);
};

type ResolvedDescriptor = {
  descriptor: TypeDescriptor;
  schemaSupport?: ReturnType<typeof schemaSupportFromSchema>;
  sourcePath: string | undefined;
};

const resolveDescriptor = (
  options: SourceOptions & SchemaOptions,
) : ResolvedDescriptor => {
  const schemaSupport = options.schema ? schemaSupportFromSchema(options.schema) : undefined;

  if (options.sourcePath) {
    const descriptor = analyzePropsDescriptor({
      exportName: options.exportName,
      propsTypeName: options.propsTypeName,
      sourcePath: normalizePath(options.sourcePath),
    });
    return {
      descriptor,
      schemaSupport,
      sourcePath: normalizePath(options.sourcePath),
    };
  }

  if (schemaSupport?.descriptor) {
    return {
      descriptor: schemaSupport.descriptor,
      schemaSupport,
      sourcePath: undefined,
    };
  }

  if (options.schema) {
    throw new Error(
      `schema vendor "${schemaSupport?.vendor ?? "unknown"}" cannot generate props directly. pass sourcePath to use React/TypeScript props as the base shape`,
    );
  }

  throw new Error("sourcePath or schema is required");
};

const normalizeValueWithSchema = (
  value: unknown,
  schemaSupport: ReturnType<typeof schemaSupportFromSchema> | undefined,
) => {
  if (!schemaSupport) {
    return {
      ok: true as const,
      value,
    };
  }
  return schemaSupport.normalizeSync(value);
};

const normalizeValuesWithSchema = <Value>(
  values: readonly Value[],
  schemaSupport: ReturnType<typeof schemaSupportFromSchema> | undefined,
) => {
  if (!schemaSupport) {
    return values.map((value) => ({
      normalized: value,
      raw: value,
    }));
  }
  const normalized: Array<{ normalized: unknown; raw: Value }> = [];
  for (const value of values) {
    const result = schemaSupport.normalizeSync(value);
    if (!result.ok) {
      continue;
    }
    normalized.push({
      normalized: result.value,
      raw: value,
    });
  }
  return normalized;
};

const resolveBoundaryCases = (
  descriptor: TypeDescriptor,
  options: {
    maxCases: number;
    render?: ComponentRenderStrategy<unknown, unknown>;
    schemaSupport?: ReturnType<typeof schemaSupportFromSchema>;
  },
) => {
  const inputDescriptor = resolveInputDescriptor(descriptor, options.render);
  const rawCases = boundaryValuesFromDescriptor(inputDescriptor, options.maxCases);
  const cases = normalizeValuesWithSchema(rawCases, options.schemaSupport);
  if (rawCases.length > 0 && cases.length === 0 && options.schemaSupport) {
    throw new Error("schema filtering removed every boundary case");
  }
  return cases.map((entry) => entry.normalized);
};

const sampleValidValues = (
  descriptor: TypeDescriptor,
  options: {
    numRuns: number;
    seed?: number;
    schemaSupport?: ReturnType<typeof schemaSupportFromSchema>;
  },
) => {
  if (!options.schemaSupport) {
    return fc.sample(arbitraryFromDescriptor(descriptor), {
      numRuns: options.numRuns,
      seed: options.seed,
    }) as unknown[];
  }

  const values: unknown[] = [];
  let batchSeed = options.seed;
  let attempts = 0;

  while (values.length < options.numRuns && attempts < options.numRuns * 16) {
    const batch = fc.sample(arbitraryFromDescriptor(descriptor), {
      numRuns: Math.max(options.numRuns * 2, 16),
      seed: batchSeed,
    });
    for (const value of batch) {
      const result = options.schemaSupport.normalizeSync(value);
      if (!result.ok) {
        continue;
      }
      values.push(result.value);
      if (values.length >= options.numRuns) {
        break;
      }
    }
    attempts += 1;
    batchSeed = batchSeed === undefined ? undefined : batchSeed + 1;
  }

  if (values.length < options.numRuns) {
    throw new Error("failed to generate enough valid props from descriptor and schema");
  }

  return values;
};

export function sampleProps<Schema extends StandardSchemaLike>(
  options: SchemaOptions<Schema> & SourceOptions & { numRuns?: number; seed?: number; schema: Schema },
): Promise<Array<SchemaOutput<Schema>>>;
export function sampleProps(
  options: SourceOptions & { numRuns?: number; seed?: number; schema?: StandardSchemaLike },
): Promise<Array<Record<string, any>>>;
export async function sampleProps(
  options: SourceOptions & { numRuns?: number; seed?: number; schema?: StandardSchemaLike },
): Promise<Array<Record<string, any>>> {
  const { descriptor, schemaSupport } = resolveDescriptor(options);
  return sampleValidValues(descriptor, {
    numRuns: options.numRuns ?? 10,
    seed: options.seed,
    schemaSupport,
  }) as Array<Record<string, any>>;
}

export function sampleBoundaryProps<Schema extends StandardSchemaLike, Component = unknown, Input = unknown>(
  options: SchemaOptions<Schema> &
    SourceOptions & { maxCases?: number; render?: ComponentRenderStrategy<Component, Input>; schema: Schema },
): Promise<Array<SchemaOutput<Schema>>>;
export function sampleBoundaryProps<Component = unknown, Input = unknown>(
  options: SourceOptions & {
    maxCases?: number;
    render?: ComponentRenderStrategy<Component, Input>;
    schema?: StandardSchemaLike;
  },
): Promise<Array<Record<string, any>>>;
export async function sampleBoundaryProps<Component = unknown, Input = unknown>(
  options: SourceOptions & {
    maxCases?: number;
    render?: ComponentRenderStrategy<Component, Input>;
    schema?: StandardSchemaLike;
  },
): Promise<Array<Record<string, any>>> {
  const { descriptor, schemaSupport } = resolveDescriptor(options);
  return resolveBoundaryCases(descriptor, {
    maxCases: options.maxCases ?? 64,
    render: options.render as ComponentRenderStrategy<unknown, unknown> | undefined,
    schemaSupport,
  }) as Array<Record<string, any>>;
}

export const samplePropsFromSchema = async <Schema extends StandardSchemaLike>(
  options: { schema: Schema; numRuns?: number; seed?: number },
): Promise<Array<SchemaOutput<Schema>>> => {
  return sampleProps(options);
};

export const sampleBoundaryPropsFromSchema = async <Schema extends StandardSchemaLike>(
  options: { schema: Schema; maxCases?: number },
): Promise<Array<SchemaOutput<Schema>>> => {
  return sampleBoundaryProps(options);
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

export const fuzzComponent = async <Component, Input = unknown>(
  options: ComponentFuzzOptions<Component, Input>,
): Promise<void> => {
  const { descriptor: componentDescriptor, schemaSupport } = resolveDescriptor(options);
  const render = resolveRender(options.component, options.render);
  const inputDescriptor = resolveInputDescriptor(componentDescriptor, options.render);
  const arbitrary = (
    schemaSupport
      ? arbitraryFromDescriptor(inputDescriptor).filter((value) => schemaSupport.normalizeSync(value).ok)
      : arbitraryFromDescriptor(inputDescriptor)
  ) as fc.Arbitrary<unknown>;
  let lastProps: unknown;

  try {
    await fc.assert(
      fc.asyncProperty(arbitrary, async (candidate) => {
        const normalized = normalizeValueWithSchema(candidate, schemaSupport);
        if (!normalized.ok) {
          return;
        }
        lastProps = normalized.value;
        await render(normalized.value);
      }),
      {
        endOnFailure: true,
        numRuns: options.numRuns ?? 100,
        seed: options.seed,
      },
    );
  } catch (error) {
    throw new ComponentFuzzError("component fuzzing failed", {
      cause: error,
      failingProps: lastProps,
      seed: options.seed,
    });
  }
};

export const fuzzComponentGuided = async <Component, Input = unknown>(
  options: ComponentGuidedFuzzOptions<Component, Input>,
): Promise<GuidedCoverageReport> => {
  const { descriptor: componentDescriptor, schemaSupport, sourcePath } = resolveDescriptor(options);
  const corpusPath = options.corpusPath ? normalizePath(options.corpusPath) : undefined;
  const render = resolveRender(options.component, options.render);
  const inputDescriptor = resolveInputDescriptor(componentDescriptor, options.render);
  const rng = new DeterministicRng(options.seed ?? 1);
  const collector = new CoverageCollector();
  const initialCorpusSize = options.initialCorpusSize ?? 8;
  const maxIterations = options.maxIterations ?? 100;
  const corpus: unknown[] = loadCorpus<unknown>(corpusPath);
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

      const normalized = normalizeValueWithSchema(candidate, schemaSupport);
      if (!normalized.ok) {
        continue;
      }
      const props = normalized.value;

      completedIterations += 1;

      await collector.reset();
      try {
        await render(props);
      } catch (error) {
        const coverage = await collector.take();
        const keys = sourcePath ? coverageKeysForTarget(coverage, sourcePath) : new Set<string>();
        let newBlocks = 0;
        for (const key of keys) {
          if (!discoveredBlocks.has(key)) {
            discoveredBlocks.add(key);
            newBlocks += 1;
          }
        }
        recordDiscovery({
          input: props,
          iteration: completedIterations,
          newBlocks,
          reason: "failure",
        });
        throw new ComponentFuzzError("guided component fuzzing failed", {
          cause: error,
          failingProps: props,
          report: {
            corpusSize: corpus.length,
            discoveries,
            discoveredBlocks: discoveredBlocks.size,
            iterations: completedIterations,
            loadedCorpusSize,
          },
          seed: options.seed,
        });
      }

      const coverage = await collector.take();
      const keys = sourcePath ? coverageKeysForTarget(coverage, sourcePath) : new Set<string>();
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
          input: props,
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
  };
};

export const quickCheckComponent = async <Component, Input = unknown>(
  options: ComponentQuickCheckOptions<Component, Input>,
): Promise<QuickCheckReport> => {
  const { descriptor: componentDescriptor, schemaSupport } = resolveDescriptor(options);
  const render = resolveRender(options.component, options.render);
  const cases = resolveBoundaryCases(componentDescriptor, {
    maxCases: options.maxCases ?? 64,
    render: options.render as ComponentRenderStrategy<unknown, unknown> | undefined,
    schemaSupport,
  });

  let checkedCases = 0;
  for (const candidate of cases) {
    checkedCases += 1;
    try {
      await render(candidate);
    } catch (error) {
      throw new ComponentFuzzError("component quick-check failed", {
        cause: error,
        failingProps: candidate,
        report: {
          checkedCases,
          totalCases: cases.length,
        },
      });
    }
  }

  return {
    checkedCases,
    totalCases: cases.length,
  };
};

export type ReactComponentRenderStrategy<Props> = ComponentRenderStrategy<
  React.ComponentType<Props>,
  Props
>;

export type ReactComponentFuzzOptions<Props, Schema extends StandardSchemaLike = StandardSchemaLike> = SourceOptions & SchemaOptions<Schema> & {
  component: React.ComponentType<Props>;
  numRuns?: number;
  render?: ReactComponentRenderStrategy<Props>;
  seed?: number;
};

export type ReactComponentGuidedFuzzOptions<Props, Schema extends StandardSchemaLike = StandardSchemaLike> = SourceOptions & SchemaOptions<Schema> & {
  component: React.ComponentType<Props>;
  corpusPath?: string | URL;
  initialCorpusSize?: number;
  maxIterations?: number;
  render?: ReactComponentRenderStrategy<Props>;
  seed?: number;
};

export type ReactComponentQuickCheckOptions<Props, Schema extends StandardSchemaLike = StandardSchemaLike> = SourceOptions & SchemaOptions<Schema> & {
  component: React.ComponentType<Props>;
  maxCases?: number;
  render?: ReactComponentRenderStrategy<Props>;
};

const defaultReactRender = async <Props>(
  component: React.ComponentType<Props>,
  props: Props,
): Promise<void> => {
  const ReactModule = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  renderToStaticMarkup(ReactModule.createElement(component as React.ComponentType<any>, props as any));
};

const resolveReactRender = <Props>(
  render: ReactComponentRenderStrategy<Props> | undefined,
): ReactComponentRenderStrategy<Props> => {
  if (render) {
    return render;
  }
  return {
    render: (component, props) => defaultReactRender(component, props as Props),
  };
};

const asReactComponentError = (error: unknown) => {
  if (!(error instanceof ComponentFuzzError)) {
    return error;
  }
  return new ReactComponentFuzzError(
    error.message
      .replace(/^guided component/, "guided react component")
      .replace(/^component/, "react component"),
    {
      cause: error.cause,
      failingProps: error.failingProps,
      report: error.report,
      seed: error.seed,
    },
  );
};

export const fuzzReactComponent = async <Props>(
  options: ReactComponentFuzzOptions<Props>,
): Promise<void> => {
  try {
    await fuzzComponent({
      ...options,
      render: resolveReactRender(options.render),
    });
  } catch (error) {
    throw asReactComponentError(error);
  }
};

export const fuzzReactComponentGuided = async <Props>(
  options: ReactComponentGuidedFuzzOptions<Props>,
): Promise<GuidedCoverageReport> => {
  try {
    return await fuzzComponentGuided({
      ...options,
      render: resolveReactRender(options.render),
    });
  } catch (error) {
    throw asReactComponentError(error);
  }
};

export const quickCheckReactComponent = async <Props>(
  options: ReactComponentQuickCheckOptions<Props>,
): Promise<QuickCheckReport> => {
  try {
    return await quickCheckComponent({
      ...options,
      render: resolveReactRender(options.render),
    });
  } catch (error) {
    throw asReactComponentError(error);
  }
};
