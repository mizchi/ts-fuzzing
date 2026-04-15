import inspector from "node:inspector";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { analyzePropsDescriptor } from "./analyzer.js";
import { arbitraryFromDescriptor } from "./arbitrary.js";
import { boundaryValuesFromDescriptor } from "./boundary.js";
import { domainBoundaryStrings, regexBoundaryStrings, } from "./string_constraints.js";
export class ReactComponentFuzzError extends Error {
    failingProps;
    seed;
    cause;
    report;
    constructor(message, options) {
        super(message, { cause: options.cause });
        this.name = "ReactComponentFuzzError";
        this.cause = options.cause;
        this.failingProps = options.failingProps;
        this.report = options.report;
        this.seed = options.seed;
    }
}
const normalizePath = (sourcePath) => {
    if (sourcePath instanceof URL) {
        return fileURLToPath(sourcePath);
    }
    return sourcePath;
};
const serializeValue = (value) => {
    if (value === undefined) {
        return { __propsFuzzingType: "undefined" };
    }
    if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
        return value;
    }
    if (typeof value === "function") {
        return { __propsFuzzingType: "function" };
    }
    if (Array.isArray(value)) {
        return value.map((item) => serializeValue(item));
    }
    if (typeof value === "object") {
        const output = {};
        for (const [key, entry] of Object.entries(value)) {
            output[key] = serializeValue(entry);
        }
        return output;
    }
    return { __propsFuzzingType: "undefined" };
};
const deserializeValue = (value) => {
    if (value === null ||
        typeof value === "boolean" ||
        typeof value === "number" ||
        typeof value === "string") {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map((item) => deserializeValue(item));
    }
    if (!("__propsFuzzingType" in value)) {
        const output = {};
        for (const [key, entry] of Object.entries(value)) {
            output[key] = deserializeValue(entry);
        }
        return output;
    }
    switch (value.__propsFuzzingType) {
        case "undefined":
            return undefined;
        case "function":
            return () => undefined;
    }
};
const loadCorpus = (corpusPath) => {
    if (!corpusPath || !fs.existsSync(corpusPath)) {
        return [];
    }
    const raw = fs.readFileSync(corpusPath, "utf8");
    const payload = JSON.parse(raw);
    if (!Array.isArray(payload)) {
        return [];
    }
    return payload.map((entry) => deserializeValue(entry));
};
const saveCorpus = (corpusPath, corpus) => {
    if (!corpusPath) {
        return;
    }
    const directory = path.dirname(corpusPath);
    fs.mkdirSync(directory, { recursive: true });
    const seen = new Set();
    const payload = [];
    for (const entry of corpus) {
        const serialized = serializeValue(entry);
        const key = JSON.stringify(serialized);
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        payload.push(serialized);
    }
    fs.writeFileSync(corpusPath, JSON.stringify(payload, null, 2));
};
const defaultRender = async (component, props) => {
    renderToStaticMarkup(createElement(component, props));
};
const resolveRender = (component, render) => {
    if (!render) {
        return (props) => defaultRender(component, props);
    }
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
export const sampleProps = async (options) => {
    const descriptor = analyzePropsDescriptor({
        exportName: options.exportName,
        propsTypeName: options.propsTypeName,
        sourcePath: normalizePath(options.sourcePath),
    });
    return fc.sample(arbitraryFromDescriptor(descriptor), {
        numRuns: options.numRuns ?? 10,
        seed: options.seed,
    });
};
export const sampleBoundaryProps = async (options) => {
    const descriptor = analyzePropsDescriptor({
        exportName: options.exportName,
        propsTypeName: options.propsTypeName,
        sourcePath: normalizePath(options.sourcePath),
    });
    const inputDescriptor = resolveInputDescriptor(descriptor, options.render);
    return boundaryValuesFromDescriptor(inputDescriptor, options.maxCases ?? 64);
};
class DeterministicRng {
    state;
    constructor(seed) {
        this.state = seed >>> 0;
    }
    float() {
        this.state = (this.state * 1_664_525 + 1_013_904_223) >>> 0;
        return this.state / 0x1_0000_0000;
    }
    int(min, max) {
        if (max <= min) {
            return min;
        }
        return min + Math.floor(this.float() * (max - min + 1));
    }
    bool(probability = 0.5) {
        return this.float() < probability;
    }
    pick(values) {
        return values[this.int(0, values.length - 1)];
    }
}
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
const clampBounds = (constraints, defaults) => {
    const min = constraints?.min ?? defaults[0];
    const max = constraints?.max ?? defaults[1];
    return [Math.min(min, max), Math.max(min, max)];
};
const clampLengths = (constraints, defaults, keys) => {
    const min = constraints?.[keys[0]] ?? defaults[0];
    const max = constraints?.[keys[1]] ?? defaults[1];
    return [Math.min(min, max), Math.max(min, max)];
};
const CHARSET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";
const generateString = (constraints, rng) => {
    if (constraints?.pattern === ".+") {
        const [minLength, maxLength] = clampLengths(constraints, [1, 16], ["minLength", "maxLength"]);
        return generateString({ ...constraints, minLength, maxLength, pattern: undefined }, rng);
    }
    const domainValues = domainBoundaryStrings(constraints);
    if (domainValues && domainValues.length > 0) {
        return rng.pick(domainValues);
    }
    const regexValues = regexBoundaryStrings(constraints);
    if (regexValues.length > 0) {
        return rng.pick(regexValues);
    }
    if (constraints?.pattern) {
        const sample = fc.sample(fc.stringMatching(new RegExp(constraints.pattern)), {
            numRuns: 1,
            seed: rng.int(1, 2_147_483_647),
        })[0];
        return String(sample);
    }
    const [minLength, maxLength] = clampLengths(constraints, [0, 16], ["minLength", "maxLength"]);
    const length = rng.int(minLength, maxLength);
    let result = "";
    for (let index = 0; index < length; index += 1) {
        result += CHARSET[rng.int(0, CHARSET.length - 1)];
    }
    return result;
};
const generateUnknown = (rng) => {
    const choice = rng.int(0, 5);
    switch (choice) {
        case 0:
            return null;
        case 1:
            return rng.bool();
        case 2:
            return rng.int(-100, 100);
        case 3:
            return generateString({ minLength: 0, maxLength: 16 }, rng);
        case 4:
            return [generateString({ maxLength: 8 }, rng)];
        default:
            return {
                id: generateString({ minLength: 1, maxLength: 8 }, rng),
                value: rng.int(-10, 10),
            };
    }
};
const generateValue = (descriptor, rng) => {
    switch (descriptor.kind) {
        case "unknown":
            return generateUnknown(rng);
        case "string":
            return generateString(descriptor.constraints, rng);
        case "number": {
            const [min, max] = clampBounds(descriptor.constraints, [-100, 100]);
            if (descriptor.integer) {
                return rng.int(min, max);
            }
            const whole = rng.int(min, max);
            return whole + Number(rng.float().toFixed(3));
        }
        case "boolean":
            return rng.bool();
        case "literal":
            return descriptor.value;
        case "null":
            return null;
        case "undefined":
            return undefined;
        case "function":
            return () => undefined;
        case "react-node":
            return rng.pick([null, rng.bool(), rng.int(-10, 10), generateString({ maxLength: 16 }, rng)]);
        case "array": {
            const [minLength, maxLength] = clampLengths(descriptor.constraints, [0, 4], ["minItems", "maxItems"]);
            const length = rng.int(minLength, maxLength);
            return Array.from({ length }, () => generateValue(descriptor.item, rng));
        }
        case "tuple":
            return descriptor.items.map((item) => generateValue(item, rng));
        case "object": {
            const output = {};
            for (const property of descriptor.properties) {
                if (property.optional && rng.bool(0.4)) {
                    continue;
                }
                output[property.key] = generateValue(property.value, rng);
            }
            return output;
        }
        case "union":
            return generateValue(rng.pick(descriptor.options), rng);
        default: {
            const _exhaustive = descriptor;
            return _exhaustive;
        }
    }
};
const matchesDescriptor = (value, descriptor) => {
    switch (descriptor.kind) {
        case "unknown":
            return true;
        case "string":
            return typeof value === "string";
        case "number":
            return typeof value === "number";
        case "boolean":
            return typeof value === "boolean";
        case "literal":
            return value === descriptor.value;
        case "null":
            return value === null;
        case "undefined":
            return value === undefined;
        case "function":
            return typeof value === "function";
        case "react-node":
            return value === null || ["string", "number", "boolean"].includes(typeof value);
        case "array":
            return Array.isArray(value);
        case "tuple":
            return Array.isArray(value) && value.length === descriptor.items.length;
        case "object":
            return typeof value === "object" && value !== null && !Array.isArray(value);
        case "union":
            return descriptor.options.some((option) => matchesDescriptor(value, option));
        default: {
            const _exhaustive = descriptor;
            return _exhaustive;
        }
    }
};
const mutateString = (current, constraints, rng) => {
    const operations = ["append", "truncate", "replace", "regenerate"];
    const operation = rng.pick(operations);
    switch (operation) {
        case "append":
            return generateString({
                ...constraints,
                minLength: Math.max(constraints?.minLength ?? 0, current.length + 1),
                maxLength: Math.max(constraints?.maxLength ?? current.length + 1, current.length + 1),
            }, rng);
        case "truncate":
            if (current.length === 0) {
                return generateString(constraints, rng);
            }
            return current.slice(0, Math.max(constraints?.minLength ?? 0, current.length - 1));
        case "replace":
            if (current.length === 0) {
                return generateString(constraints, rng);
            }
            return `${current.slice(0, -1)}${CHARSET[rng.int(0, CHARSET.length - 1)]}`;
        case "regenerate":
            return generateString(constraints, rng);
    }
};
const mutateObject = (current, descriptor, rng) => {
    const next = { ...current };
    const property = rng.pick(descriptor.properties);
    if (property.optional && rng.bool(0.25)) {
        delete next[property.key];
        return next;
    }
    const existingValue = next[property.key];
    next[property.key] = mutateValue(existingValue, property.value, rng);
    for (const required of descriptor.properties) {
        if (!required.optional && !(required.key in next)) {
            next[required.key] = generateValue(required.value, rng);
        }
    }
    return next;
};
const mutateValue = (current, descriptor, rng) => {
    if (!matchesDescriptor(current, descriptor)) {
        return generateValue(descriptor, rng);
    }
    switch (descriptor.kind) {
        case "unknown":
            return generateUnknown(rng);
        case "string":
            return mutateString(current, descriptor.constraints, rng);
        case "number": {
            const [min, max] = clampBounds(descriptor.constraints, [-100, 100]);
            if (descriptor.integer) {
                const delta = rng.pick([-1, 1, 2, -2]);
                const candidate = Math.min(max, Math.max(min, current + delta));
                return candidate;
            }
            const candidate = current + (rng.bool() ? 0.5 : -0.5);
            return Math.min(max, Math.max(min, candidate));
        }
        case "boolean":
            return !current;
        case "literal":
            return descriptor.value;
        case "null":
            return null;
        case "undefined":
            return undefined;
        case "function":
            return current;
        case "react-node":
            return generateValue(descriptor, rng);
        case "array": {
            const array = Array.isArray(current) ? [...current] : [];
            const [minLength, maxLength] = clampLengths(descriptor.constraints, [0, 4], ["minItems", "maxItems"]);
            if (array.length === 0) {
                return [generateValue(descriptor.item, rng)];
            }
            const operation = rng.pick(["mutate", "push", "pop"]);
            if (operation === "mutate") {
                const index = rng.int(0, array.length - 1);
                array[index] = mutateValue(array[index], descriptor.item, rng);
            }
            else if (operation === "push" && array.length < maxLength) {
                array.push(generateValue(descriptor.item, rng));
            }
            else if (operation === "pop" && array.length > minLength) {
                array.pop();
            }
            return array;
        }
        case "tuple":
            return descriptor.items.map((item, index) => mutateValue(current[index], item, rng));
        case "object":
            return mutateObject(current, descriptor, rng);
        case "union": {
            const matching = descriptor.options.find((option) => matchesDescriptor(current, option)) ??
                rng.pick(descriptor.options);
            return mutateValue(current, matching, rng);
        }
        default: {
            const _exhaustive = descriptor;
            return _exhaustive;
        }
    }
};
const coverageKeysForTarget = (coverage, sourcePath) => {
    const normalizedPath = path.resolve(sourcePath).replaceAll("\\", "/");
    const fileUrl = pathToFileURL(path.resolve(sourcePath)).href;
    const keys = new Set();
    for (const script of coverage) {
        const url = script.url.replaceAll("\\", "/");
        if (!url.includes(normalizedPath) && !url.startsWith(fileUrl)) {
            continue;
        }
        for (const fn of script.functions) {
            for (const range of fn.ranges) {
                if (range.count <= 0) {
                    continue;
                }
                keys.add(`${url}:${range.startOffset}-${range.endOffset}`);
            }
        }
    }
    return keys;
};
export const fuzzReactComponent = async (options) => {
    const componentDescriptor = analyzePropsDescriptor({
        exportName: options.exportName,
        propsTypeName: options.propsTypeName,
        sourcePath: normalizePath(options.sourcePath),
    });
    const render = resolveRender(options.component, options.render);
    const inputDescriptor = resolveInputDescriptor(componentDescriptor, options.render);
    const arbitrary = arbitraryFromDescriptor(inputDescriptor);
    let lastProps;
    try {
        await fc.assert(fc.asyncProperty(arbitrary, async (props) => {
            lastProps = props;
            await render(props);
        }), {
            endOnFailure: true,
            numRuns: options.numRuns ?? 100,
            seed: options.seed,
        });
    }
    catch (error) {
        throw new ReactComponentFuzzError("react component fuzzing failed", {
            cause: error,
            failingProps: lastProps,
            seed: options.seed,
        });
    }
};
export const fuzzReactComponentGuided = async (options) => {
    const sourcePath = normalizePath(options.sourcePath);
    const corpusPath = options.corpusPath ? normalizePath(options.corpusPath) : undefined;
    const componentDescriptor = analyzePropsDescriptor({
        exportName: options.exportName,
        propsTypeName: options.propsTypeName,
        sourcePath,
    });
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
        for (let iteration = 0; iteration < maxIterations; iteration += 1) {
            const props = corpus.length === 0 || iteration < initialCorpusSize
                ? generateValue(inputDescriptor, rng)
                : mutateValue(rng.pick(corpus), inputDescriptor, rng);
            await collector.reset();
            try {
                await render(props);
            }
            catch (error) {
                const coverage = await collector.take();
                const keys = coverageKeysForTarget(coverage, sourcePath);
                let newBlocks = 0;
                for (const key of keys) {
                    if (!discoveredBlocks.has(key)) {
                        discoveredBlocks.add(key);
                        newBlocks += 1;
                    }
                }
                recordDiscovery({
                    input: props,
                    iteration: iteration + 1,
                    newBlocks,
                    reason: "failure",
                });
                throw new ReactComponentFuzzError("guided react component fuzzing failed", {
                    cause: error,
                    failingProps: props,
                    report: {
                        corpusSize: corpus.length,
                        discoveries,
                        discoveredBlocks: discoveredBlocks.size,
                        iterations: iteration + 1,
                        loadedCorpusSize,
                    },
                    seed: options.seed,
                });
            }
            const coverage = await collector.take();
            const keys = coverageKeysForTarget(coverage, sourcePath);
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
                    iteration: iteration + 1,
                    newBlocks,
                    reason: "coverage",
                });
            }
            if (discoveredNewBlock || corpus.length < initialCorpusSize) {
                corpus.push(props);
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
        iterations: maxIterations,
        loadedCorpusSize,
    };
};
export const quickCheckReactComponent = async (options) => {
    const componentDescriptor = analyzePropsDescriptor({
        exportName: options.exportName,
        propsTypeName: options.propsTypeName,
        sourcePath: normalizePath(options.sourcePath),
    });
    const render = resolveRender(options.component, options.render);
    const inputDescriptor = resolveInputDescriptor(componentDescriptor, options.render);
    const cases = boundaryValuesFromDescriptor(inputDescriptor, options.maxCases ?? 64);
    let checkedCases = 0;
    for (const candidate of cases) {
        checkedCases += 1;
        try {
            await render(candidate);
        }
        catch (error) {
            throw new ReactComponentFuzzError("react component quick-check failed", {
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
//# sourceMappingURL=fuzz.js.map