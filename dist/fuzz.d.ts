import type { StandardSchemaV1 } from "@standard-schema/spec";
import type * as React from "react";
import type { TypeDescriptor } from "./descriptor.js";
import type { StandardSchemaLike } from "./schema.js";
type SchemaOutput<Schema extends StandardSchemaLike> = StandardSchemaV1.InferOutput<Schema>;
export type SourceOptions = {
    sourcePath?: string | URL;
    exportName?: string;
    propsTypeName?: string;
};
export type SchemaOptions<Schema extends StandardSchemaLike = StandardSchemaLike> = {
    schema?: Schema;
};
export type ComponentRenderStrategy<Component, Input = unknown> = ((input: Input) => unknown | Promise<unknown>) | {
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
export declare class ComponentFuzzError extends Error {
    failingProps: unknown;
    seed: number | undefined;
    cause: unknown;
    report: GuidedCoverageReport | QuickCheckReport | undefined;
    constructor(message: string, options: {
        cause: unknown;
        failingProps: unknown;
        report?: GuidedCoverageReport | QuickCheckReport;
        seed?: number;
    });
}
export declare class ReactComponentFuzzError extends ComponentFuzzError {
    constructor(message: string, options: {
        cause: unknown;
        failingProps: unknown;
        report?: GuidedCoverageReport | QuickCheckReport;
        seed?: number;
    });
}
export declare function sampleProps<Schema extends StandardSchemaLike>(options: SchemaOptions<Schema> & SourceOptions & {
    numRuns?: number;
    seed?: number;
    schema: Schema;
}): Promise<Array<SchemaOutput<Schema>>>;
export declare function sampleProps(options: SourceOptions & {
    numRuns?: number;
    seed?: number;
    schema?: StandardSchemaLike;
}): Promise<Array<Record<string, any>>>;
export declare function sampleBoundaryProps<Schema extends StandardSchemaLike, Component = unknown, Input = unknown>(options: SchemaOptions<Schema> & SourceOptions & {
    maxCases?: number;
    render?: ComponentRenderStrategy<Component, Input>;
    schema: Schema;
}): Promise<Array<SchemaOutput<Schema>>>;
export declare function sampleBoundaryProps<Component = unknown, Input = unknown>(options: SourceOptions & {
    maxCases?: number;
    render?: ComponentRenderStrategy<Component, Input>;
    schema?: StandardSchemaLike;
}): Promise<Array<Record<string, any>>>;
export declare const samplePropsFromSchema: <Schema extends StandardSchemaLike>(options: {
    schema: Schema;
    numRuns?: number;
    seed?: number;
}) => Promise<Array<SchemaOutput<Schema>>>;
export declare const sampleBoundaryPropsFromSchema: <Schema extends StandardSchemaLike>(options: {
    schema: Schema;
    maxCases?: number;
}) => Promise<Array<SchemaOutput<Schema>>>;
export declare const fuzzComponent: <Component, Input = unknown>(options: ComponentFuzzOptions<Component, Input>) => Promise<void>;
export declare const fuzzComponentGuided: <Component, Input = unknown>(options: ComponentGuidedFuzzOptions<Component, Input>) => Promise<GuidedCoverageReport>;
export declare const quickCheckComponent: <Component, Input = unknown>(options: ComponentQuickCheckOptions<Component, Input>) => Promise<QuickCheckReport>;
export type ReactComponentRenderStrategy<Props> = ComponentRenderStrategy<React.ComponentType<Props>, Props>;
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
export declare const fuzzReactComponent: <Props>(options: ReactComponentFuzzOptions<Props>) => Promise<void>;
export declare const fuzzReactComponentGuided: <Props>(options: ReactComponentGuidedFuzzOptions<Props>) => Promise<GuidedCoverageReport>;
export declare const quickCheckReactComponent: <Props>(options: ReactComponentQuickCheckOptions<Props>) => Promise<QuickCheckReport>;
export {};
//# sourceMappingURL=fuzz.d.ts.map