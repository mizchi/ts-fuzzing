import React from "react";
import type { TypeDescriptor } from "./descriptor.js";
type SourceOptions = {
    sourcePath: string | URL;
    exportName?: string;
    propsTypeName?: string;
};
export type ReactComponentRenderStrategy<Props> = ((props: Props) => unknown | Promise<unknown>) | {
    describeInput?: (componentPropsDescriptor: TypeDescriptor) => TypeDescriptor;
    render: (component: React.ComponentType<Props>, props: unknown) => unknown | Promise<unknown>;
};
export type ReactComponentFuzzOptions<Props> = SourceOptions & {
    component: React.ComponentType<Props>;
    numRuns?: number;
    render?: ReactComponentRenderStrategy<Props>;
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
export type ReactComponentGuidedFuzzOptions<Props> = SourceOptions & {
    component: React.ComponentType<Props>;
    corpusPath?: string | URL;
    initialCorpusSize?: number;
    maxIterations?: number;
    render?: ReactComponentRenderStrategy<Props>;
    seed?: number;
};
export type ReactComponentQuickCheckOptions<Props> = SourceOptions & {
    component: React.ComponentType<Props>;
    maxCases?: number;
    render?: ReactComponentRenderStrategy<Props>;
};
export declare class ReactComponentFuzzError extends Error {
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
export declare const sampleProps: (options: SourceOptions & {
    numRuns?: number;
    seed?: number;
}) => Promise<Array<Record<string, any>>>;
export declare const sampleBoundaryProps: <Props>(options: SourceOptions & {
    maxCases?: number;
    render?: ReactComponentRenderStrategy<Props>;
}) => Promise<Array<Record<string, any>>>;
export declare const fuzzReactComponent: <Props>(options: ReactComponentFuzzOptions<Props>) => Promise<void>;
export declare const fuzzReactComponentGuided: <Props>(options: ReactComponentGuidedFuzzOptions<Props>) => Promise<GuidedCoverageReport>;
export declare const quickCheckReactComponent: <Props>(options: ReactComponentQuickCheckOptions<Props>) => Promise<QuickCheckReport>;
export {};
//# sourceMappingURL=fuzz.d.ts.map