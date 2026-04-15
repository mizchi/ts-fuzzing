import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import fc from "fast-check";
import type { FuzzConstraints, ObjectDescriptor, TypeDescriptor } from "./descriptor.js";
import { domainBoundaryStrings, regexBoundaryStrings } from "./string_constraints.js";

export type SerializedValue =
  | null
  | boolean
  | number
  | string
  | { __tsFuzzingType: "function" }
  | { __tsFuzzingType: "map"; entries: [SerializedValue, SerializedValue][] }
  | { __tsFuzzingType: "set"; values: SerializedValue[] }
  | { __tsFuzzingType: "undefined" }
  | { __tsFuzzingType: "url"; value: string }
  | SerializedValue[]
  | { [key: string]: SerializedValue };

export const serializeValue = (value: unknown): SerializedValue => {
  if (value === undefined) {
    return { __tsFuzzingType: "undefined" };
  }
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return value;
  }
  if (typeof value === "function") {
    return { __tsFuzzingType: "function" };
  }
  if (value instanceof URL) {
    return { __tsFuzzingType: "url", value: value.href };
  }
  if (value instanceof Map) {
    return {
      __tsFuzzingType: "map",
      entries: [...value.entries()].map(([key, entry]) => [serializeValue(key), serializeValue(entry)]),
    };
  }
  if (value instanceof Set) {
    return {
      __tsFuzzingType: "set",
      values: [...value.values()].map((entry) => serializeValue(entry)),
    };
  }
  if (Array.isArray(value)) {
    return value.map((item) => serializeValue(item));
  }
  if (typeof value === "object") {
    const output: Record<string, SerializedValue> = {};
    for (const [key, entry] of Object.entries(value)) {
      output[key] = serializeValue(entry);
    }
    return output;
  }
  return { __tsFuzzingType: "undefined" };
};

export const deserializeValue = (value: SerializedValue): unknown => {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => deserializeValue(item));
  }
  if (!("__tsFuzzingType" in value)) {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      output[key] = deserializeValue(entry);
    }
    return output;
  }
  switch (value.__tsFuzzingType) {
    case "undefined":
      return undefined;
    case "function":
      return () => undefined;
    case "url":
      return new URL((value as Extract<SerializedValue, { __tsFuzzingType: "url" }>).value);
    case "map": {
      const entries = (value as Extract<SerializedValue, { __tsFuzzingType: "map" }>).entries;
      return new Map(entries.map(([key, entry]) => [deserializeValue(key), deserializeValue(entry)]));
    }
    case "set": {
      const entries = (value as Extract<SerializedValue, { __tsFuzzingType: "set" }>).values;
      return new Set(entries.map((entry) => deserializeValue(entry)));
    }
  }
};

export const loadCorpus = <Input>(corpusPath: string | undefined): Input[] => {
  if (!corpusPath || !fs.existsSync(corpusPath)) {
    return [];
  }
  const raw = fs.readFileSync(corpusPath, "utf8");
  const payload = JSON.parse(raw) as SerializedValue[];
  if (!Array.isArray(payload)) {
    return [];
  }
  return payload.map((entry) => deserializeValue(entry) as Input);
};

export const saveCorpus = <Input>(corpusPath: string | undefined, corpus: Input[]) => {
  if (!corpusPath) {
    return;
  }
  const directory = path.dirname(corpusPath);
  fs.mkdirSync(directory, { recursive: true });
  const seen = new Set<string>();
  const payload: SerializedValue[] = [];
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

export class DeterministicRng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  float() {
    this.state = (this.state * 1_664_525 + 1_013_904_223) >>> 0;
    return this.state / 0x1_0000_0000;
  }

  int(min: number, max: number) {
    if (max <= min) {
      return min;
    }
    return min + Math.floor(this.float() * (max - min + 1));
  }

  bool(probability = 0.5) {
    return this.float() < probability;
  }

  pick<T>(values: readonly T[]): T {
    return values[this.int(0, values.length - 1)];
  }
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

export const clampBounds = (constraints: FuzzConstraints | undefined, defaults: [number, number]) => {
  const min = constraints?.min ?? defaults[0];
  const max = constraints?.max ?? defaults[1];
  return [Math.min(min, max), Math.max(min, max)] as const;
};

export const clampLengths = (
  constraints: FuzzConstraints | undefined,
  defaults: [number, number],
  keys: ["minItems" | "minLength", "maxItems" | "maxLength"],
) => {
  const min = constraints?.[keys[0]] ?? defaults[0];
  const max = constraints?.[keys[1]] ?? defaults[1];
  return [Math.min(min, max), Math.max(min, max)] as const;
};

const CHARSET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";

export const generateString = (constraints: FuzzConstraints | undefined, rng: DeterministicRng): string => {
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

export const generateUnknown = (rng: DeterministicRng): unknown => {
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

export const generateValue = (descriptor: TypeDescriptor, rng: DeterministicRng): unknown => {
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
    case "url":
      return new URL(generateString({ pattern: "url", minLength: 1 }, rng));
    case "map": {
      const length = rng.int(0, 4);
      return new Map(
        Array.from({ length }, () => [
          generateValue(descriptor.key, rng),
          generateValue(descriptor.value, rng),
        ]),
      );
    }
    case "set": {
      const length = rng.int(0, 4);
      return new Set(
        Array.from({ length }, () => generateValue(descriptor.item, rng)),
      );
    }
    case "array": {
      const [minLength, maxLength] = clampLengths(
        descriptor.constraints,
        [0, 4],
        ["minItems", "maxItems"],
      );
      const length = rng.int(minLength, maxLength);
      return Array.from({ length }, () => generateValue(descriptor.item, rng));
    }
    case "tuple":
      return descriptor.items.map((item) => generateValue(item, rng));
    case "object": {
      const output: Record<string, unknown> = {};
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
      const _exhaustive: never = descriptor;
      return _exhaustive;
    }
  }
};

export const matchesDescriptor = (value: unknown, descriptor: TypeDescriptor): boolean => {
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
    case "url":
      return value instanceof URL;
    case "map":
      return value instanceof Map;
    case "set":
      return value instanceof Set;
    case "array":
      return Array.isArray(value);
    case "tuple":
      return Array.isArray(value) && value.length === descriptor.items.length;
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case "union":
      return descriptor.options.some((option) => matchesDescriptor(value, option));
    default: {
      const _exhaustive: never = descriptor;
      return _exhaustive;
    }
  }
};

export const mutateString = (
  current: string,
  constraints: FuzzConstraints | undefined,
  rng: DeterministicRng,
): string => {
  const operations = ["append", "truncate", "replace", "regenerate"] as const;
  const operation = rng.pick(operations);
  switch (operation) {
    case "append":
      return generateString(
        {
          ...constraints,
          minLength: Math.max(constraints?.minLength ?? 0, current.length + 1),
          maxLength: Math.max(constraints?.maxLength ?? current.length + 1, current.length + 1),
        },
        rng,
      );
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

export const mutateObject = (
  current: Record<string, unknown>,
  descriptor: ObjectDescriptor,
  rng: DeterministicRng,
): Record<string, unknown> => {
  const next: Record<string, unknown> = { ...current };
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

export const mutateValue = (
  current: unknown,
  descriptor: TypeDescriptor,
  rng: DeterministicRng,
): unknown => {
  if (!matchesDescriptor(current, descriptor)) {
    return generateValue(descriptor, rng);
  }

  switch (descriptor.kind) {
    case "unknown":
      return generateUnknown(rng);
    case "string":
      return mutateString(current as string, descriptor.constraints, rng);
    case "number": {
      const [min, max] = clampBounds(descriptor.constraints, [-100, 100]);
      if (descriptor.integer) {
        const delta = rng.pick([-1, 1, 2, -2]);
        const candidate = Math.min(max, Math.max(min, (current as number) + delta));
        return candidate;
      }
      const candidate = (current as number) + (rng.bool() ? 0.5 : -0.5);
      return Math.min(max, Math.max(min, candidate));
    }
    case "boolean":
      return !(current as boolean);
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
    case "url":
      return generateValue(descriptor, rng);
    case "map": {
      const currentMap = current instanceof Map ? new Map(current) : new Map();
      if (currentMap.size === 0 || rng.bool(0.4)) {
        currentMap.set(generateValue(descriptor.key, rng), generateValue(descriptor.value, rng));
        return currentMap;
      }
      const entries = [...currentMap.entries()];
      const [key] = entries[rng.int(0, entries.length - 1)]!;
      if (rng.bool(0.25)) {
        currentMap.delete(key);
        return currentMap;
      }
      currentMap.set(key, mutateValue(currentMap.get(key), descriptor.value, rng));
      return currentMap;
    }
    case "set": {
      const currentSet = current instanceof Set ? new Set(current) : new Set();
      if (currentSet.size === 0 || rng.bool(0.4)) {
        currentSet.add(generateValue(descriptor.item, rng));
        return currentSet;
      }
      const values = [...currentSet.values()];
      const entry = values[rng.int(0, values.length - 1)]!;
      currentSet.delete(entry);
      if (!rng.bool(0.25)) {
        currentSet.add(mutateValue(entry, descriptor.item, rng));
      }
      return currentSet;
    }
    case "array": {
      const array = Array.isArray(current) ? [...current] : [];
      const [minLength, maxLength] = clampLengths(
        descriptor.constraints,
        [0, 4],
        ["minItems", "maxItems"],
      );
      if (array.length === 0) {
        return [generateValue(descriptor.item, rng)];
      }
      const operation = rng.pick(["mutate", "push", "pop"] as const);
      if (operation === "mutate") {
        const index = rng.int(0, array.length - 1);
        array[index] = mutateValue(array[index], descriptor.item, rng);
      } else if (operation === "push" && array.length < maxLength) {
        array.push(generateValue(descriptor.item, rng));
      } else if (operation === "pop" && array.length > minLength) {
        array.pop();
      }
      return array;
    }
    case "tuple":
      return descriptor.items.map((item, index) =>
        mutateValue((current as unknown[])[index], item, rng),
      );
    case "object":
      return mutateObject(current as Record<string, unknown>, descriptor, rng);
    case "union": {
      const matching =
        descriptor.options.find((option) => matchesDescriptor(current, option)) ??
        rng.pick(descriptor.options);
      return mutateValue(current, matching, rng);
    }
    default: {
      const _exhaustive: never = descriptor;
      return _exhaustive;
    }
  }
};

export const coverageKeysForTarget = (coverage: ScriptCoverage[], sourcePath: string) => {
  const normalizedPath = path.resolve(sourcePath).replaceAll("\\", "/");
  const fileUrl = pathToFileURL(path.resolve(sourcePath)).href;
  const keys = new Set<string>();

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
