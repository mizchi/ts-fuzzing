import type { StandardSchemaLike } from "./schema.js";
import {
  ValueFuzzError,
  fuzzValues,
  fuzzValuesGuided,
  quickCheckValues,
  type GuidedCoverageReport,
  type GuidedCoverageDiscovery,
  type QuickCheckReport,
  type ValueFuzzOptions,
  type ValueGuidedFuzzOptions,
  type ValueQuickCheckOptions,
} from "./input_fuzz.js";
import type { InputDescriptorTransform, SchemaOptions, SourceOptions } from "./fuzz_data.js";

export type ComponentRenderStrategy<Component, Input = unknown> =
  | ((input: Input) => unknown | Promise<unknown>)
  | {
      describeInput?: InputDescriptorTransform;
      render: (component: Component, input: unknown) => unknown | Promise<unknown>;
    };

export type ComponentFuzzOptions<Component, Input = unknown, Schema extends StandardSchemaLike = StandardSchemaLike> = SourceOptions & SchemaOptions<Schema> & {
  component: Component;
  numRuns?: number;
  render: ComponentRenderStrategy<Component, Input>;
  seed?: number;
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

export { GuidedCoverageDiscovery, GuidedCoverageReport, QuickCheckReport };

export class ComponentFuzzError extends ValueFuzzError {
  constructor(message: string, options: {
    cause: unknown;
    failingValue: unknown;
    report?: GuidedCoverageReport | QuickCheckReport;
    seed?: number;
    warnings?: string[];
  }) {
    super(message, options);
    this.name = "ComponentFuzzError";
  }
}

const resolveRun = <Component, Input>(
  component: Component,
  render: ComponentRenderStrategy<Component, Input>,
) => {
  if (typeof render === "function") {
    return (value: Input) => render(value);
  }
  return (value: Input) => render.render(component, value);
};

const resolveDescribeInput = <Component, Input>(
  render: ComponentRenderStrategy<Component, Input> | undefined,
) => {
  if (!render || typeof render === "function") {
    return undefined;
  }
  return render.describeInput;
};

const asComponentError = (error: unknown) => {
  if (!(error instanceof ValueFuzzError)) {
    return error;
  }
  return new ComponentFuzzError(
    error.message
      .replace(/^guided value/, "guided component")
      .replace(/^value/, "component"),
    {
      cause: error.cause,
      failingValue: error.failingValue,
      report: error.report,
      seed: error.seed,
      warnings: error.warnings,
    },
  );
};

export const fuzzComponent = async <Component, Input = unknown>(
  options: ComponentFuzzOptions<Component, Input>,
): Promise<void> => {
  try {
    await fuzzValues({
      ...(options as Omit<ValueFuzzOptions<Input>, "run">),
      run: {
        describeInput: resolveDescribeInput(options.render),
        run: resolveRun(options.component, options.render),
      },
    });
  } catch (error) {
    throw asComponentError(error);
  }
};

export const fuzzComponentGuided = async <Component, Input = unknown>(
  options: ComponentGuidedFuzzOptions<Component, Input>,
): Promise<GuidedCoverageReport> => {
  try {
    return await fuzzValuesGuided({
      ...(options as Omit<ValueGuidedFuzzOptions<Input>, "run">),
      run: {
        describeInput: resolveDescribeInput(options.render),
        run: resolveRun(options.component, options.render),
      },
    });
  } catch (error) {
    throw asComponentError(error);
  }
};

export const quickCheckComponent = async <Component, Input = unknown>(
  options: ComponentQuickCheckOptions<Component, Input>,
): Promise<QuickCheckReport> => {
  try {
    return await quickCheckValues({
      ...(options as Omit<ValueQuickCheckOptions<Input>, "run">),
      run: {
        describeInput: resolveDescribeInput(options.render),
        run: resolveRun(options.component, options.render),
      },
    });
  } catch (error) {
    throw asComponentError(error);
  }
};
