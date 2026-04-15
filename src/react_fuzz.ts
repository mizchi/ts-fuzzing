import type * as React from "react";
import type { StandardSchemaLike } from "./schema.js";
import {
  ComponentFuzzError,
  fuzzComponent,
  fuzzComponentGuided,
  quickCheckComponent,
  type ComponentFuzzOptions,
  type ComponentGuidedFuzzOptions,
  type ComponentRenderStrategy,
  type ComponentQuickCheckOptions,
  type GuidedCoverageReport,
  type QuickCheckReport,
} from "./component_fuzz.js";
import type { SchemaOptions, SourceOptions } from "./fuzz_data.js";

export class ReactComponentFuzzError extends ComponentFuzzError {
  constructor(message: string, options: {
    cause: unknown;
    failingValue: unknown;
    report?: GuidedCoverageReport | QuickCheckReport;
    seed?: number;
    warnings?: string[];
  }) {
    super(message, options);
    this.name = "ReactComponentFuzzError";
  }
}

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
      failingValue: error.failingValue,
      report: error.report,
      seed: error.seed,
      warnings: error.warnings,
    },
  );
};

export const fuzzReactComponent = async <Props>(
  options: ReactComponentFuzzOptions<Props>,
): Promise<void> => {
  try {
    await fuzzComponent({
      ...(options as ComponentFuzzOptions<React.ComponentType<Props>, Props>),
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
      ...(options as ComponentGuidedFuzzOptions<React.ComponentType<Props>, Props>),
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
      ...(options as ComponentQuickCheckOptions<React.ComponentType<Props>, Props>),
      render: resolveReactRender(options.render),
    });
  } catch (error) {
    throw asReactComponentError(error);
  }
};
