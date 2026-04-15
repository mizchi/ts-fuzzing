import type { StandardSchemaV1 } from "@standard-schema/spec";
import * as v from "valibot";
import * as z from "zod";
import { describe, expect, test } from "vitest";
import { schemaSupportFromSchema } from "../src/schema.js";

const withVendorSchema = <Value extends Record<string, unknown>>(
  vendor: string,
  value: Value,
): Value & StandardSchemaV1<unknown> => ({
  ...value,
  "~standard": {
    types: undefined,
    validate(input) {
      return {
        value: input,
      };
    },
    vendor,
    version: 1,
  },
}) as Value & StandardSchemaV1<unknown>;

describe("schema adapters", () => {
  test("extracts rich descriptors from zod schemas", () => {
    const schema = z.object({
      email: z.string().email().min(3).max(32),
      count: z.coerce.number().int().min(1).max(3),
      enabled: z.boolean(),
      literal: z.literal("x"),
      variant: z.enum(["safe", "danger"]),
      items: z.array(z.string().min(1)).min(1).max(2),
      tuple: z.tuple([z.string(), z.number()]),
      maybe: z.string().nullable(),
      callback: z.function({ input: [], output: z.void() }),
      anything: z.unknown(),
      optionalLabel: z.string().default("x"),
      transformed: z.string().transform((value) => value.toUpperCase()),
      piped: z.string().pipe(z.string().min(2)),
    });

    const support = schemaSupportFromSchema(schema);
    expect(support.vendor).toBe("zod");
    expect(support.descriptor?.kind).toBe("object");
    const properties = Object.fromEntries(
      support.descriptor?.kind === "object" ? support.descriptor.properties.map((property) => [property.key, property]) : [],
    );
    expect(properties.email).toMatchObject({ optional: false, value: { kind: "string", constraints: { minLength: 3, maxLength: 32, pattern: "email" } } });
    expect(properties.count).toMatchObject({ optional: false, value: { kind: "number", integer: true, constraints: { min: 1, max: 3 } } });
    expect(properties.enabled).toMatchObject({ optional: false, value: { kind: "boolean" } });
    expect(properties.literal).toMatchObject({ optional: false, value: { kind: "literal", value: "x" } });
    expect(properties.variant).toMatchObject({ optional: false, value: { kind: "union" } });
    expect(properties.items).toMatchObject({ optional: false, value: { kind: "array" } });
    expect(properties.tuple).toMatchObject({ optional: false, value: { kind: "tuple" } });
    expect(properties.maybe).toMatchObject({ optional: false, value: { kind: "union" } });
    expect(properties.callback).toMatchObject({ optional: false, value: { kind: "function" } });
    expect(properties.anything).toMatchObject({ optional: false, value: { kind: "unknown" } });
    expect(properties.optionalLabel).toMatchObject({ optional: true, value: { kind: "string" } });
    expect(properties.transformed).toMatchObject({ optional: false, value: { kind: "string" } });
    expect(properties.piped).toMatchObject({ optional: false, value: { kind: "string" } });

    const normalized = support.normalizeSync({ email: "a@b.co", count: "2", enabled: true, literal: "x", variant: "safe", items: ["a"], tuple: ["x", 1], maybe: null, callback: () => undefined, anything: {}, transformed: "ok", piped: "aa" });
    expect(normalized.ok).toBe(true);
    if (normalized.ok) {
      expect(normalized.value.count).toBe(2);
      expect(normalized.value.transformed).toBe("OK");
    }
  });

  test("extracts rich descriptors from valibot schemas", () => {
    const schema = v.object({
      email: v.pipe(v.string(), v.email(), v.minLength(3), v.maxLength(32)),
      count: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(3)),
      enabled: v.boolean(),
      literal: v.literal("x"),
      variant: v.picklist(["safe", "danger"]),
      items: v.pipe(v.array(v.string()), v.minLength(1), v.maxLength(2)),
      tuple: v.tuple([v.string(), v.number()]),
      maybe: v.nullable(v.string()),
      anything: v.unknown(),
      optionalLabel: v.optional(v.string()),
    });

    const support = schemaSupportFromSchema(schema);
    expect(support.vendor).toBe("valibot");
    expect(support.descriptor?.kind).toBe("object");
    const properties = Object.fromEntries(
      support.descriptor?.kind === "object" ? support.descriptor.properties.map((property) => [property.key, property]) : [],
    );
    expect(properties.email).toMatchObject({ optional: false, value: { kind: "string", constraints: { minLength: 3, maxLength: 32, pattern: "email" } } });
    expect(properties.count).toMatchObject({ optional: false, value: { kind: "number", integer: true, constraints: { min: 1, max: 3 } } });
    expect(properties.enabled).toMatchObject({ optional: false, value: { kind: "boolean" } });
    expect(properties.literal).toMatchObject({ optional: false, value: { kind: "literal", value: "x" } });
    expect(properties.variant).toMatchObject({ optional: false, value: { kind: "union" } });
    expect(properties.items).toMatchObject({ optional: false, value: { kind: "array", constraints: { minItems: 1, maxItems: 2 } } });
    expect(properties.tuple).toMatchObject({ optional: false, value: { kind: "tuple" } });
    expect(properties.maybe).toMatchObject({ optional: false, value: { kind: "union" } });
    expect(properties.anything).toMatchObject({ optional: false, value: { kind: "unknown" } });
    expect(properties.optionalLabel).toMatchObject({ optional: true, value: { kind: "string" } });
  });

  test("supports custom standard schema normalization and invalid inputs", () => {
    const schema: StandardSchemaV1<{ label: string }, { label: string }> = {
      "~standard": {
        types: undefined,
        validate(value) {
          if (typeof value !== "object" || value === null || typeof (value as { label?: unknown }).label !== "string") {
            return { issues: [{ message: "invalid" }] };
          }
          return {
            value: {
              label: (value as { label: string }).label.toUpperCase(),
            },
          };
        },
        vendor: "custom",
        version: 1,
      },
    };

    const support = schemaSupportFromSchema(schema);
    expect(support.descriptor).toBeUndefined();
    expect(support.validateSync({ label: "ok" })).toBe(true);
    expect(support.validateSync({})).toBe(false);
    expect(support.normalizeSync({ label: "ok" })).toEqual({ ok: true, value: { label: "OK" } });
    expect(support.normalizeSync({})).toEqual({ ok: false, issues: [{ message: "invalid" }] });
  });

  test("rejects invalid or async standard schemas", () => {
    expect(() => schemaSupportFromSchema({} as never)).toThrow("schema must implement StandardSchemaV1");

    const asyncSchema: StandardSchemaV1<{ label: string }> = {
      "~standard": {
        types: undefined,
        validate: async (value) => ({ value: value as { label: string } }),
        vendor: "custom",
        version: 1,
      },
    };

    const support = schemaSupportFromSchema(asyncSchema);
    expect(() => support.validateSync({ label: "ok" })).toThrow("async standard schema validation is not supported");
    expect(() => support.normalizeSync({ label: "ok" })).toThrow("async standard schema validation is not supported");
  });

  test("covers zod adapter fallback branches with synthetic schemas", () => {
    const support = schemaSupportFromSchema(withVendorSchema("zod", {
      type: "object",
      shape: {
        singleEnum: {
          type: "enum",
          enum: { only: "only" },
        },
        optionalText: {
          type: "optional",
          def: {
            innerType: {
              type: "string",
              def: {
                checks: [
                  undefined,
                  { def: { format: "regex", pattern: /ab+/ } },
                  { def: { check: "max_length", maximum: 5 } },
                ],
              },
            },
          },
        },
        caught: {
          type: "catch",
          def: { innerType: { type: "string", format: "email" } },
        },
        nonoptional: {
          type: "nonoptional",
          def: { innerType: { type: "number", minValue: 1 } },
        },
        prefault: {
          type: "prefault",
          def: { innerType: { type: "boolean" } },
        },
        readonly: {
          type: "readonly",
          def: { innerType: { type: "string", def: { checks: [{ _zod: { def: { format: "url" } } }, { _zod: { def: { check: "min_length", minimum: 2 } } }] } } },
        },
        pipeOut: {
          type: "pipe",
          def: {
            out: {
              type: "string",
            },
          },
        },
        fallbackLiteral: {
          type: "literal",
          def: { values: ["fallback"] },
        },
        emptyObject: {
          type: "object",
        },
        arrayFromDef: {
          type: "array",
          def: {
            element: { type: "string" },
          },
          minLength: 1,
        },
        tupleFromDef: {
          type: "tuple",
          def: {
            items: [{ type: "string" }],
          },
        },
        emptyTuple: {
          type: "tuple",
        },
        emptyUnion: {
          type: "union",
        },
        nullish: {
          type: "null",
        },
        callback: {
          type: "function",
        },
        fallbackUnknown: {
          type: "mystery",
        },
      },
    }));

    expect(support.vendor).toBe("zod");
    expect(support.descriptor?.kind).toBe("object");
    const properties = Object.fromEntries(
      support.descriptor?.kind === "object" ? support.descriptor.properties.map((property) => [property.key, property]) : [],
    );
    expect(properties.singleEnum).toMatchObject({ value: { kind: "literal", value: "only" } });
    expect(properties.optionalText).toMatchObject({
      optional: true,
      value: { kind: "string", constraints: { maxLength: 5, pattern: "ab+" } },
    });
    expect(properties.caught).toMatchObject({
      value: { kind: "string", constraints: { pattern: "email" } },
    });
    expect(properties.nonoptional).toMatchObject({
      value: { kind: "number", constraints: { min: 1 } },
    });
    expect(properties.prefault).toMatchObject({ value: { kind: "boolean" } });
    expect(properties.readonly).toMatchObject({
      value: { kind: "string", constraints: { minLength: 2, pattern: "url" } },
    });
    expect(properties.pipeOut).toMatchObject({ value: { kind: "string" } });
    expect(properties.fallbackLiteral).toMatchObject({ value: { kind: "literal", value: "fallback" } });
    expect(properties.emptyObject).toMatchObject({ value: { kind: "object", properties: [] } });
    expect(properties.arrayFromDef).toMatchObject({
      value: { kind: "array", item: { kind: "string" }, constraints: { minItems: 1 } },
    });
    expect(properties.tupleFromDef).toMatchObject({
      value: { kind: "tuple", items: [{ kind: "string" }] },
    });
    expect(properties.emptyTuple).toMatchObject({ value: { kind: "tuple", items: [] } });
    expect(properties.emptyUnion).toMatchObject({ value: { kind: "union", options: [] } });
    expect(properties.nullish).toMatchObject({ value: { kind: "null" } });
    expect(properties.callback).toMatchObject({ value: { kind: "function" } });
    expect(properties.fallbackUnknown).toMatchObject({ value: { kind: "unknown" } });
  });

  test("covers valibot adapter fallback branches with synthetic schemas", () => {
    const support = schemaSupportFromSchema(withVendorSchema("valibot", {
      type: "object",
      entries: {
        regexText: {
          type: "string",
          pipe: [{ type: "regex", requirement: /xy+/ }],
        },
        looseText: {
          type: "string",
          pipe: [
            { type: "min_length", requirement: "bad" },
            { type: "max_length", requirement: null },
          ],
        },
        minOnlyNumber: {
          type: "number",
          pipe: [{ type: "min_value", requirement: 1 }],
        },
        enumFallback: {
          type: "enum",
          enum: { first: "first" },
        },
        emptyObject: {
          type: "object",
        },
        arrayWithoutPipe: {
          type: "array",
          item: { type: "string" },
        },
        emptyTuple: {
          type: "tuple",
        },
        emptyUnion: {
          type: "union",
        },
        exactOptional: {
          type: "exact_optional",
          wrapped: { type: "string" },
        },
        nullableOptional: {
          type: "nullish",
          wrapped: { type: "string" },
        },
        anyValue: {
          type: "any",
        },
        unknownFallback: {
          type: "mystery",
        },
      },
    }));

    expect(support.vendor).toBe("valibot");
    expect(support.descriptor?.kind).toBe("object");
    const properties = Object.fromEntries(
      support.descriptor?.kind === "object" ? support.descriptor.properties.map((property) => [property.key, property]) : [],
    );
    expect(properties.regexText).toMatchObject({
      value: { kind: "string", constraints: { pattern: "xy+" } },
    });
    expect(properties.looseText).toMatchObject({
      value: { kind: "string", constraints: undefined },
    });
    expect(properties.minOnlyNumber).toMatchObject({
      value: { kind: "number", integer: false, constraints: { min: 1 } },
    });
    expect(properties.enumFallback).toMatchObject({
      value: { kind: "literal", value: "first" },
    });
    expect(properties.emptyObject).toMatchObject({
      value: { kind: "object", properties: [] },
    });
    expect(properties.arrayWithoutPipe).toMatchObject({
      value: { kind: "array", item: { kind: "string" } },
    });
    expect(properties.emptyTuple).toMatchObject({
      value: { kind: "tuple", items: [] },
    });
    expect(properties.emptyUnion).toMatchObject({
      value: { kind: "union", options: [] },
    });
    expect(properties.exactOptional).toMatchObject({
      optional: true,
      value: { kind: "string" },
    });
    expect(properties.nullableOptional).toMatchObject({
      optional: true,
      value: { kind: "union", options: [{ kind: "string" }, { kind: "null" }] },
    });
    expect(properties.anyValue).toMatchObject({
      value: { kind: "unknown" },
    });
    expect(properties.unknownFallback).toMatchObject({
      value: { kind: "unknown" },
    });
  });
});
