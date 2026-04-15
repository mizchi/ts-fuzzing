import type { FuzzConstraints, ObjectDescriptor, TypeDescriptor } from "./descriptor.js";
export type SerializedValue = null | boolean | number | string | {
    __propsFuzzingType: "function";
} | {
    __propsFuzzingType: "undefined";
} | SerializedValue[] | {
    [key: string]: SerializedValue;
};
export declare const serializeValue: (value: unknown) => SerializedValue;
export declare const deserializeValue: (value: SerializedValue) => unknown;
export declare const loadCorpus: <Input>(corpusPath: string | undefined) => Input[];
export declare const saveCorpus: <Input>(corpusPath: string | undefined, corpus: Input[]) => void;
export declare class DeterministicRng {
    private state;
    constructor(seed: number);
    float(): number;
    int(min: number, max: number): number;
    bool(probability?: number): boolean;
    pick<T>(values: readonly T[]): T;
}
export type ScriptRange = {
    count: number;
    endOffset: number;
    startOffset: number;
};
export type ScriptFunctionCoverage = {
    functionName: string;
    ranges: ScriptRange[];
};
export type ScriptCoverage = {
    functions: ScriptFunctionCoverage[];
    url: string;
};
export declare const clampBounds: (constraints: FuzzConstraints | undefined, defaults: [number, number]) => readonly [number, number];
export declare const clampLengths: (constraints: FuzzConstraints | undefined, defaults: [number, number], keys: ["minItems" | "minLength", "maxItems" | "maxLength"]) => readonly [number, number];
export declare const generateString: (constraints: FuzzConstraints | undefined, rng: DeterministicRng) => string;
export declare const generateUnknown: (rng: DeterministicRng) => unknown;
export declare const generateValue: (descriptor: TypeDescriptor, rng: DeterministicRng) => unknown;
export declare const matchesDescriptor: (value: unknown, descriptor: TypeDescriptor) => boolean;
export declare const mutateString: (current: string, constraints: FuzzConstraints | undefined, rng: DeterministicRng) => string;
export declare const mutateObject: (current: Record<string, unknown>, descriptor: ObjectDescriptor, rng: DeterministicRng) => Record<string, unknown>;
export declare const mutateValue: (current: unknown, descriptor: TypeDescriptor, rng: DeterministicRng) => unknown;
export declare const coverageKeysForTarget: (coverage: ScriptCoverage[], sourcePath: string) => Set<string>;
//# sourceMappingURL=fuzz_internal.d.ts.map