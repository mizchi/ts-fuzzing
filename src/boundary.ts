import type { ObjectDescriptor, TypeDescriptor } from "./descriptor.js";
import {
  domainBoundaryStrings,
  genericBoundaryStrings,
  regexBoundaryStrings,
} from "./string_constraints.js";

const OMIT = Symbol("omit");

const stableSerialize = (value: unknown): string => {
  return JSON.stringify(value, (_key, entry) => {
    if (typeof entry === "function") {
      return { __propsFuzzingType: "function" };
    }
    if (entry === undefined) {
      return { __propsFuzzingType: "undefined" };
    }
    return entry;
  });
};

const dedupe = <T>(values: T[]) => {
  const seen = new Set<string>();
  const output: T[] = [];
  for (const value of values) {
    const key = stableSerialize(value);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(value);
  }
  return output;
};

const combine = (parts: unknown[][], maxCases: number): unknown[][] => {
  let output: unknown[][] = [[]];
  for (const part of parts) {
    const next: unknown[][] = [];
    for (const prefix of output) {
      for (const value of part) {
        next.push([...prefix, value]);
        if (next.length >= maxCases) {
          return next;
        }
      }
    }
    output = next;
  }
  return output;
};

const objectBoundaryValues = (descriptor: ObjectDescriptor, maxCases: number): Record<string, unknown>[] => {
  const propertyValues = descriptor.properties.map((property) => {
    const values = boundaryValuesFromDescriptor(property.value, Math.max(4, Math.floor(maxCases / 2)));
    return property.optional ? [OMIT, ...values] : values;
  });

  const combinations = combine(propertyValues, maxCases);
  return dedupe(
    combinations.map((values) => {
      const output: Record<string, unknown> = {};
      for (const [index, value] of values.entries()) {
        if (value === OMIT) {
          continue;
        }
        output[descriptor.properties[index].key] = value;
      }
      return output;
    }),
  ).slice(0, maxCases);
};

export const boundaryValuesFromDescriptor = (
  descriptor: TypeDescriptor,
  maxCases = 64,
): unknown[] => {
  switch (descriptor.kind) {
    case "unknown":
      return [null, "", 0, false, {}];
    case "string": {
      const domainValues = domainBoundaryStrings(descriptor.constraints);
      if (domainValues && domainValues.length > 0) {
        return dedupe(domainValues).slice(0, maxCases);
      }
      const regexValues = regexBoundaryStrings(descriptor.constraints);
      if (regexValues.length > 0) {
        return dedupe(regexValues).slice(0, maxCases);
      }
      return genericBoundaryStrings(descriptor.constraints).slice(0, maxCases);
    }
    case "number": {
      const min = descriptor.constraints?.min ?? -1;
      const max = descriptor.constraints?.max ?? 1;
      const values = [min, Math.min(max, min + 1), Math.max(min, max - 1), max];
      return dedupe(values).slice(0, maxCases);
    }
    case "boolean":
      return [false, true];
    case "literal":
      return [descriptor.value];
    case "null":
      return [null];
    case "undefined":
      return [undefined];
    case "function":
      return [() => undefined];
    case "react-node":
      return [null, "", "x", 0, 1, false, true].slice(0, maxCases);
    case "array": {
      const minLength = descriptor.constraints?.minItems ?? 0;
      const maxLength = Math.max(minLength, descriptor.constraints?.maxItems ?? Math.max(minLength, 2));
      const itemValues = boundaryValuesFromDescriptor(descriptor.item, 4);
      const lengths = dedupe([minLength, Math.min(maxLength, minLength + 1), maxLength]);
      return lengths.map((length) =>
        Array.from({ length }, (_unused, index) => itemValues[index % Math.max(1, itemValues.length)]),
      );
    }
    case "tuple": {
      const parts = descriptor.items.map((item) => boundaryValuesFromDescriptor(item, 4));
      return combine(parts, maxCases).slice(0, maxCases);
    }
    case "object":
      return objectBoundaryValues(descriptor, maxCases);
    case "union":
      return dedupe(
        descriptor.options.flatMap((option) =>
          boundaryValuesFromDescriptor(option, Math.max(4, Math.floor(maxCases / descriptor.options.length))),
        ),
      ).slice(0, maxCases);
    default: {
      const _exhaustive: never = descriptor;
      return _exhaustive;
    }
  }
};
