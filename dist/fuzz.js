import inspector from "node:inspector";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { analyzePropsDescriptor } from "./analyzer.js";
import { arbitraryFromDescriptor } from "./arbitrary.js";
import { boundaryValuesFromDescriptor } from "./boundary.js";
import { coverageKeysForTarget, DeterministicRng, generateValue, loadCorpus, mutateValue, saveCorpus, } from "./fuzz_internal.js";
import { schemaSupportFromSchema } from "./schema.js";
export class ComponentFuzzError extends Error {
    failingProps;
    seed;
    cause;
    report;
    constructor(message, options) {
        super(message, { cause: options.cause });
        this.name = "ComponentFuzzError";
        this.cause = options.cause;
        this.failingProps = options.failingProps;
        this.report = options.report;
        this.seed = options.seed;
    }
}
export class ReactComponentFuzzError extends ComponentFuzzError {
    constructor(message, options) {
        super(message, options);
        this.name = "ReactComponentFuzzError";
    }
}
const normalizePath = (sourcePath) => {
    if (sourcePath instanceof URL) {
        return fileURLToPath(sourcePath);
    }
    return sourcePath;
};
const resolveRender = (component, render) => {
    if (typeof render === "function") {
        return (props) => render(props);
    }
    return (props) => render.render(component, props);
};
const resolveInputDescriptor = (componentPropsDescriptor, render) => {
    if (!render || typeof render === "function" || !render.describeInput) {
        return componentPropsDescriptor;
    }
    return render.describeInput(componentPropsDescriptor);
};
const resolveDescriptor = (options) => {
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
        throw new Error(`schema vendor "${schemaSupport?.vendor ?? "unknown"}" cannot generate props directly. pass sourcePath to use React/TypeScript props as the base shape`);
    }
    throw new Error("sourcePath or schema is required");
};
const normalizeValueWithSchema = (value, schemaSupport) => {
    if (!schemaSupport) {
        return {
            ok: true,
            value,
        };
    }
    return schemaSupport.normalizeSync(value);
};
const normalizeValuesWithSchema = (values, schemaSupport) => {
    if (!schemaSupport) {
        return values.map((value) => ({
            normalized: value,
            raw: value,
        }));
    }
    const normalized = [];
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
const resolveBoundaryCases = (descriptor, options) => {
    const inputDescriptor = resolveInputDescriptor(descriptor, options.render);
    const rawCases = boundaryValuesFromDescriptor(inputDescriptor, options.maxCases);
    const cases = normalizeValuesWithSchema(rawCases, options.schemaSupport);
    if (rawCases.length > 0 && cases.length === 0 && options.schemaSupport) {
        throw new Error("schema filtering removed every boundary case");
    }
    return cases.map((entry) => entry.normalized);
};
const sampleValidValues = (descriptor, options) => {
    if (!options.schemaSupport) {
        return fc.sample(arbitraryFromDescriptor(descriptor), {
            numRuns: options.numRuns,
            seed: options.seed,
        });
    }
    const values = [];
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
export async function sampleProps(options) {
    const { descriptor, schemaSupport } = resolveDescriptor(options);
    return sampleValidValues(descriptor, {
        numRuns: options.numRuns ?? 10,
        seed: options.seed,
        schemaSupport,
    });
}
export async function sampleBoundaryProps(options) {
    const { descriptor, schemaSupport } = resolveDescriptor(options);
    return resolveBoundaryCases(descriptor, {
        maxCases: options.maxCases ?? 64,
        render: options.render,
        schemaSupport,
    });
}
export const samplePropsFromSchema = async (options) => {
    return sampleProps(options);
};
export const sampleBoundaryPropsFromSchema = async (options) => {
    return sampleBoundaryProps(options);
};
const inspectorPost = async (session, method, params) => {
    return await new Promise((resolve, reject) => {
        session.post(method, params ?? {}, (error, result) => {
            if (error) {
                reject(error);
                return;
            }
            resolve(result);
        });
    });
};
class CoverageCollector {
    session = new inspector.Session();
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
    async take() {
        const result = await inspectorPost(this.session, "Profiler.takePreciseCoverage");
        return result.result;
    }
    async stop() {
        try {
            await inspectorPost(this.session, "Profiler.stopPreciseCoverage");
        }
        finally {
            try {
                await inspectorPost(this.session, "Profiler.disable");
            }
            finally {
                this.session.disconnect();
            }
        }
    }
}
export const fuzzComponent = async (options) => {
    const { descriptor: componentDescriptor, schemaSupport } = resolveDescriptor(options);
    const render = resolveRender(options.component, options.render);
    const inputDescriptor = resolveInputDescriptor(componentDescriptor, options.render);
    const arbitrary = (schemaSupport
        ? arbitraryFromDescriptor(inputDescriptor).filter((value) => schemaSupport.normalizeSync(value).ok)
        : arbitraryFromDescriptor(inputDescriptor));
    let lastProps;
    try {
        await fc.assert(fc.asyncProperty(arbitrary, async (candidate) => {
            const normalized = normalizeValueWithSchema(candidate, schemaSupport);
            if (!normalized.ok) {
                return;
            }
            lastProps = normalized.value;
            await render(normalized.value);
        }), {
            endOnFailure: true,
            numRuns: options.numRuns ?? 100,
            seed: options.seed,
        });
    }
    catch (error) {
        throw new ComponentFuzzError("component fuzzing failed", {
            cause: error,
            failingProps: lastProps,
            seed: options.seed,
        });
    }
};
export const fuzzComponentGuided = async (options) => {
    const { descriptor: componentDescriptor, schemaSupport, sourcePath } = resolveDescriptor(options);
    const corpusPath = options.corpusPath ? normalizePath(options.corpusPath) : undefined;
    const render = resolveRender(options.component, options.render);
    const inputDescriptor = resolveInputDescriptor(componentDescriptor, options.render);
    const rng = new DeterministicRng(options.seed ?? 1);
    const collector = new CoverageCollector();
    const initialCorpusSize = options.initialCorpusSize ?? 8;
    const maxIterations = options.maxIterations ?? 100;
    const corpus = loadCorpus(corpusPath);
    const discoveries = [];
    const loadedCorpusSize = corpus.length;
    const discoveredBlocks = new Set();
    let completedIterations = 0;
    const recordDiscovery = (entry) => {
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
            const candidate = corpus.length === 0 || completedIterations < initialCorpusSize
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
            }
            catch (error) {
                const coverage = await collector.take();
                const keys = sourcePath ? coverageKeysForTarget(coverage, sourcePath) : new Set();
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
            const keys = sourcePath ? coverageKeysForTarget(coverage, sourcePath) : new Set();
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
    }
    finally {
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
export const quickCheckComponent = async (options) => {
    const { descriptor: componentDescriptor, schemaSupport } = resolveDescriptor(options);
    const render = resolveRender(options.component, options.render);
    const cases = resolveBoundaryCases(componentDescriptor, {
        maxCases: options.maxCases ?? 64,
        render: options.render,
        schemaSupport,
    });
    let checkedCases = 0;
    for (const candidate of cases) {
        checkedCases += 1;
        try {
            await render(candidate);
        }
        catch (error) {
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
const defaultReactRender = async (component, props) => {
    const ReactModule = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    renderToStaticMarkup(ReactModule.createElement(component, props));
};
const resolveReactRender = (render) => {
    if (render) {
        return render;
    }
    return {
        render: (component, props) => defaultReactRender(component, props),
    };
};
const asReactComponentError = (error) => {
    if (!(error instanceof ComponentFuzzError)) {
        return error;
    }
    return new ReactComponentFuzzError(error.message
        .replace(/^guided component/, "guided react component")
        .replace(/^component/, "react component"), {
        cause: error.cause,
        failingProps: error.failingProps,
        report: error.report,
        seed: error.seed,
    });
};
export const fuzzReactComponent = async (options) => {
    try {
        await fuzzComponent({
            ...options,
            render: resolveReactRender(options.render),
        });
    }
    catch (error) {
        throw asReactComponentError(error);
    }
};
export const fuzzReactComponentGuided = async (options) => {
    try {
        return await fuzzComponentGuided({
            ...options,
            render: resolveReactRender(options.render),
        });
    }
    catch (error) {
        throw asReactComponentError(error);
    }
};
export const quickCheckReactComponent = async (options) => {
    try {
        return await quickCheckComponent({
            ...options,
            render: resolveReactRender(options.render),
        });
    }
    catch (error) {
        throw asReactComponentError(error);
    }
};
//# sourceMappingURL=fuzz.js.map