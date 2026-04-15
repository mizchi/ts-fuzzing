import fc from "fast-check";
import type { Arbitrary } from "fast-check";
import type { ObjectDescriptor, TypeDescriptor } from "./descriptor.js";
import { domainStringArbitrary } from "./string_constraints.js";

const boundedInteger = (min: number | undefined, max: number | undefined) => {
  return fc.integer({
    min: min ?? Number.MIN_SAFE_INTEGER,
    max: max ?? Number.MAX_SAFE_INTEGER,
  });
};

const boundedDouble = (min: number | undefined, max: number | undefined) => {
  return fc.double({
    min: min ?? -1_000_000,
    max: max ?? 1_000_000,
    noDefaultInfinity: true,
    noNaN: true,
  });
};

const unknownArbitrary = (): Arbitrary<unknown> => {
  return fc.oneof(
    fc.constant(null),
    fc.boolean(),
    fc.integer(),
    fc.double({ noNaN: true, noDefaultInfinity: true }),
    fc.string({ maxLength: 32 }),
    fc.array(fc.string({ maxLength: 8 }), { maxLength: 4 }),
    fc.record(
      {
        id: fc.string({ maxLength: 8 }),
        value: fc.integer(),
      },
      { requiredKeys: [] },
    ),
  );
};

const arbitraryFromObject = (descriptor: ObjectDescriptor): Arbitrary<Record<string, unknown>> => {
  const model: Record<string, Arbitrary<unknown>> = {};
  const requiredKeys: string[] = [];

  for (const property of descriptor.properties) {
    model[property.key] = arbitraryFromDescriptor(property.value);
    if (!property.optional) {
      requiredKeys.push(property.key);
    }
  }

  return fc.record(model, { requiredKeys });
};

export const arbitraryFromDescriptor = (descriptor: TypeDescriptor): Arbitrary<unknown> => {
  switch (descriptor.kind) {
    case "unknown":
      return unknownArbitrary();
    case "string": {
      const domainArbitrary = domainStringArbitrary(descriptor.constraints);
      if (domainArbitrary) {
        return domainArbitrary;
      }
      const pattern = descriptor.constraints?.pattern;
      if (pattern) {
        return fc.stringMatching(new RegExp(pattern));
      }
      return fc.string({
        minLength: descriptor.constraints?.minLength,
        maxLength: descriptor.constraints?.maxLength,
      });
    }
    case "number":
      return descriptor.integer
        ? boundedInteger(descriptor.constraints?.min, descriptor.constraints?.max)
        : boundedDouble(descriptor.constraints?.min, descriptor.constraints?.max);
    case "boolean":
      return fc.boolean();
    case "literal":
      return fc.constant(descriptor.value);
    case "null":
      return fc.constant(null);
    case "undefined":
      return fc.constant(undefined);
    case "function":
      return fc.constant(() => undefined);
    case "react-node":
      return fc.oneof(
        fc.constant(null),
        fc.string({ maxLength: 32 }),
        fc.integer(),
        fc.boolean(),
      );
    case "url": {
      const domainArbitrary = domainStringArbitrary({ pattern: "url" });
      return (domainArbitrary ?? fc.webUrl()).map((value) => new URL(value));
    }
    case "map":
      return fc
        .array(fc.tuple(arbitraryFromDescriptor(descriptor.key), arbitraryFromDescriptor(descriptor.value)), {
          maxLength: 4,
        })
        .map((entries) => new Map(entries));
    case "set":
      return fc
        .array(arbitraryFromDescriptor(descriptor.item), {
          maxLength: 4,
        })
        .map((items) => new Set(items));
    case "array":
      return fc.array(arbitraryFromDescriptor(descriptor.item), {
        minLength: descriptor.constraints?.minItems,
        maxLength: descriptor.constraints?.maxItems,
      });
    case "tuple":
      return fc.tuple(...descriptor.items.map((item) => arbitraryFromDescriptor(item)));
    case "object":
      return arbitraryFromObject(descriptor);
    case "union":
      return fc.oneof(...descriptor.options.map((option) => arbitraryFromDescriptor(option)));
    default: {
      const _exhaustive: never = descriptor;
      return _exhaustive;
    }
  }
};
