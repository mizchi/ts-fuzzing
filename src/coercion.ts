import type { ObjectDescriptor, TypeDescriptor } from "./descriptor.js";

export type CoercionMode = "strict" | "falsy-aware";

export type NullInjectionMode = "respect-type" | "never" | "aggressive";

const FALSY_AWARE_BOOLEAN_OPTIONS: TypeDescriptor[] = [
  { kind: "literal", value: true },
  { kind: "literal", value: false },
  { kind: "literal", value: 0 },
  { kind: "literal", value: "" },
  { kind: "literal", value: null },
  { kind: "undefined" },
  { kind: "literal", value: "0" },
  { kind: "literal", value: "false" },
  { kind: "literal", value: " " },
];

export const applyCoercion = (
  descriptor: TypeDescriptor,
  mode: CoercionMode | undefined,
): TypeDescriptor => {
  if (mode !== "falsy-aware") {
    return descriptor;
  }
  return transform(descriptor);
};

const transform = (descriptor: TypeDescriptor): TypeDescriptor => {
  switch (descriptor.kind) {
    case "boolean":
      return { kind: "union", options: FALSY_AWARE_BOOLEAN_OPTIONS.slice() };
    case "array":
      return { ...descriptor, item: transform(descriptor.item) };
    case "tuple":
      return { ...descriptor, items: descriptor.items.map(transform) };
    case "object":
      return {
        ...descriptor,
        properties: descriptor.properties.map((property) => ({
          ...property,
          value: transform(property.value),
        })),
      };
    case "union":
      return { ...descriptor, options: descriptor.options.map(transform) };
    case "map":
      return {
        ...descriptor,
        key: transform(descriptor.key),
        value: transform(descriptor.value),
      };
    case "set":
      return { ...descriptor, item: transform(descriptor.item) };
    default:
      return descriptor;
  }
};

const isNullOrUndefinedDescriptor = (descriptor: TypeDescriptor): boolean =>
  descriptor.kind === "null" || descriptor.kind === "undefined";

const stripNullable = (descriptor: TypeDescriptor): TypeDescriptor => {
  switch (descriptor.kind) {
    case "union": {
      const filtered = descriptor.options
        .filter((option) => !isNullOrUndefinedDescriptor(option))
        .map(stripNullable);
      if (filtered.length === 0) {
        return descriptor;
      }
      if (filtered.length === 1) {
        return filtered[0];
      }
      return { ...descriptor, options: filtered };
    }
    case "array":
      return { ...descriptor, item: stripNullable(descriptor.item) };
    case "tuple":
      return { ...descriptor, items: descriptor.items.map(stripNullable) };
    case "object":
      return stripNullableObject(descriptor);
    case "map":
      return {
        ...descriptor,
        key: stripNullable(descriptor.key),
        value: stripNullable(descriptor.value),
      };
    case "set":
      return { ...descriptor, item: stripNullable(descriptor.item) };
    default:
      return descriptor;
  }
};

const stripNullableObject = (descriptor: ObjectDescriptor): ObjectDescriptor => ({
  ...descriptor,
  properties: descriptor.properties.map((property) => ({
    ...property,
    optional: false,
    value: stripNullable(property.value),
  })),
});

const aggressiveNullable = (descriptor: TypeDescriptor): TypeDescriptor => {
  switch (descriptor.kind) {
    case "null":
    case "undefined":
    case "unknown":
      return descriptor;
    case "union": {
      const options = descriptor.options.map(aggressiveNullable);
      const hasNull = options.some((option) => option.kind === "null");
      const hasUndefined = options.some((option) => option.kind === "undefined");
      const next: TypeDescriptor[] = [...options];
      if (!hasNull) next.push({ kind: "null" });
      if (!hasUndefined) next.push({ kind: "undefined" });
      return { ...descriptor, options: next };
    }
    case "array":
      return wrapWithNullable({ ...descriptor, item: aggressiveNullable(descriptor.item) });
    case "tuple":
      return wrapWithNullable({ ...descriptor, items: descriptor.items.map(aggressiveNullable) });
    case "object":
      return wrapWithNullable({
        ...descriptor,
        properties: descriptor.properties.map((property) => ({
          ...property,
          value: aggressiveNullable(property.value),
        })),
      });
    case "map":
      return wrapWithNullable({
        ...descriptor,
        key: aggressiveNullable(descriptor.key),
        value: aggressiveNullable(descriptor.value),
      });
    case "set":
      return wrapWithNullable({ ...descriptor, item: aggressiveNullable(descriptor.item) });
    default:
      return wrapWithNullable(descriptor);
  }
};

const wrapWithNullable = (descriptor: TypeDescriptor): TypeDescriptor => ({
  kind: "union",
  options: [descriptor, { kind: "null" }, { kind: "undefined" }],
});

export const applyNullInjection = (
  descriptor: TypeDescriptor,
  mode: NullInjectionMode | undefined,
): TypeDescriptor => {
  switch (mode) {
    case "never":
      return stripNullable(descriptor);
    case "aggressive":
      return aggressiveNullable(descriptor);
    case "respect-type":
    case undefined:
    default:
      return descriptor;
  }
};
