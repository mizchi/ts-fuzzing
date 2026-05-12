import type { TypeDescriptor } from "./descriptor.js";

export type CoercionMode = "strict" | "falsy-aware";

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
