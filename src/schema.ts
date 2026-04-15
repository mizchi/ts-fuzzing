import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { FuzzConstraints, PropertyDescriptor, TypeDescriptor } from "./descriptor.js";

export type StandardSchemaLike<Input = unknown, Output = Input> = StandardSchemaV1<Input, Output>;
type SchemaInput<Schema extends StandardSchemaLike> = StandardSchemaV1.InferInput<Schema>;
type SchemaOutput<Schema extends StandardSchemaLike> = StandardSchemaV1.InferOutput<Schema>;

type NormalizedSchemaResult<Value> =
  | {
      ok: true;
      value: Value;
    }
  | {
      issues: readonly StandardSchemaV1.Issue[] | undefined;
      ok: false;
    };

export type SchemaDescriptorSupport<Schema extends StandardSchemaLike = StandardSchemaLike> = {
  descriptor?: TypeDescriptor;
  normalizeSync: (value: unknown) => NormalizedSchemaResult<SchemaOutput<Schema>>;
  schema: Schema;
  validateSync: (value: unknown) => value is SchemaInput<Schema>;
  vendor: string;
};

type SchemaDescriptorAdapter = {
  descriptorFromSchema: (schema: StandardSchemaLike) => TypeDescriptor;
};

const mergeConstraints = (
  left: FuzzConstraints | undefined,
  right: FuzzConstraints | undefined,
): FuzzConstraints | undefined => {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return {
    ...left,
    ...right,
  };
};

const isStandardSchemaLike = (value: unknown): value is StandardSchemaLike => {
  return typeof value === "object" && value !== null && "~standard" in value;
};

const literalUnion = (values: Array<string | number | boolean | null>): TypeDescriptor => {
  if (values.length === 1) {
    return {
      kind: "literal",
      value: values[0],
    };
  }
  return {
    kind: "union",
    options: values.map((value) => ({
      kind: "literal",
      value,
    })),
  };
};

const objectPropertiesFromEntries = (
  entries: Record<string, unknown>,
  unwrap: (schema: unknown) => { descriptor: TypeDescriptor; optional: boolean },
): PropertyDescriptor[] => {
  return Object.entries(entries).map(([key, value]) => {
    const { descriptor, optional } = unwrap(value);
    return {
      key,
      optional,
      value: descriptor,
    };
  });
};

const zodStringConstraints = (schema: any): FuzzConstraints | undefined => {
  let constraints: FuzzConstraints | undefined;

  if (typeof schema.minLength === "number") {
    constraints = mergeConstraints(constraints, { minLength: schema.minLength });
  }
  if (typeof schema.maxLength === "number") {
    constraints = mergeConstraints(constraints, { maxLength: schema.maxLength });
  }
  if (schema.format === "email" || schema.format === "url") {
    constraints = mergeConstraints(constraints, { pattern: schema.format });
  }

  for (const check of schema.def?.checks ?? []) {
    const definition = check?._zod?.def ?? check?.def;
    if (!definition) {
      continue;
    }
    if (definition.format === "email" || definition.format === "url") {
      constraints = mergeConstraints(constraints, { pattern: definition.format });
    }
    if (definition.format === "regex" && definition.pattern instanceof RegExp) {
      constraints = mergeConstraints(constraints, { pattern: definition.pattern.source });
    }
    if (definition.check === "min_length" && typeof definition.minimum === "number") {
      constraints = mergeConstraints(constraints, { minLength: definition.minimum });
    }
    if (definition.check === "max_length" && typeof definition.maximum === "number") {
      constraints = mergeConstraints(constraints, { maxLength: definition.maximum });
    }
  }

  return constraints;
};

const zodDescriptor = (schema: any): TypeDescriptor => {
  switch (schema?.type) {
    case "catch":
    case "default":
    case "nonoptional":
    case "prefault":
    case "readonly":
      return zodDescriptor(schema.def?.innerType);
    case "pipe":
      return zodDescriptor(schema.def?.in ?? schema.def?.out);
    case "string":
      return {
        kind: "string",
        constraints: zodStringConstraints(schema),
      };
    case "number":
      return {
        kind: "number",
        constraints: mergeConstraints(
          typeof schema.minValue === "number" ? { min: schema.minValue } : undefined,
          typeof schema.maxValue === "number" ? { max: schema.maxValue } : undefined,
        ),
        integer: Boolean(schema.isInt),
      };
    case "boolean":
      return { kind: "boolean" };
    case "literal":
      return {
        kind: "literal",
        value: schema.value ?? schema.def?.values?.[0] ?? null,
      };
    case "enum":
      return literalUnion([...(schema.options ?? Object.values(schema.enum ?? {}))]);
    case "object": {
      const shape = typeof schema.shape === "object" && schema.shape !== null ? schema.shape : {};
      return {
        kind: "object",
        properties: objectPropertiesFromEntries(shape, unwrapZodSchema),
      };
    }
    case "array":
      return {
        kind: "array",
        item: zodDescriptor(schema.element ?? schema.def?.element),
        constraints: mergeConstraints(
          typeof schema.minLength === "number" ? { minItems: schema.minLength } : undefined,
          typeof schema.maxLength === "number" ? { maxItems: schema.maxLength } : undefined,
        ),
      };
    case "tuple":
      return {
        kind: "tuple",
        items: (schema.items ?? schema.def?.items ?? []).map((item: any) => zodDescriptor(item)),
      };
    case "union":
      return {
        kind: "union",
        options: (schema.options ?? []).map((option: any) => zodDescriptor(option)),
      };
    case "nullable":
      return {
        kind: "union",
        options: [zodDescriptor(schema.def?.innerType), { kind: "null" }],
      };
    case "null":
      return { kind: "null" };
    case "unknown":
    case "any":
      return { kind: "unknown" };
    case "function":
      return { kind: "function" };
    default:
      return { kind: "unknown" };
  }
};

const unwrapZodSchema = (schema: any): { descriptor: TypeDescriptor; optional: boolean } => {
  let current = schema;
  let optional = false;

  while (current?.type === "optional" || current?.type === "default") {
    optional = true;
    current = current.def?.innerType;
  }

  return {
    descriptor: zodDescriptor(current),
    optional,
  };
};

const valibotStringConstraints = (schema: any): FuzzConstraints | undefined => {
  let constraints: FuzzConstraints | undefined;
  const pipe = schema?.pipe ?? [];
  for (const step of pipe) {
    switch (step?.type) {
      case "min_length":
        if (typeof step.requirement === "number") {
          constraints = mergeConstraints(constraints, { minLength: step.requirement });
        }
        break;
      case "max_length":
        if (typeof step.requirement === "number") {
          constraints = mergeConstraints(constraints, { maxLength: step.requirement });
        }
        break;
      case "email":
        constraints = mergeConstraints(constraints, { pattern: "email" });
        break;
      case "url":
        constraints = mergeConstraints(constraints, { pattern: "url" });
        break;
      case "regex":
        if (step.requirement instanceof RegExp) {
          constraints = mergeConstraints(constraints, { pattern: step.requirement.source });
        }
        break;
    }
  }
  return constraints;
};

const valibotNumberConstraints = (schema: any) => {
  let constraints: FuzzConstraints | undefined;
  let integer = false;

  for (const step of schema?.pipe ?? []) {
    switch (step?.type) {
      case "integer":
        integer = true;
        break;
      case "min_value":
        if (typeof step.requirement === "number") {
          constraints = mergeConstraints(constraints, { min: step.requirement });
        }
        break;
      case "max_value":
        if (typeof step.requirement === "number") {
          constraints = mergeConstraints(constraints, { max: step.requirement });
        }
        break;
    }
  }

  return {
    constraints,
    integer,
  };
};

const valibotDescriptor = (schema: any): TypeDescriptor => {
  switch (schema?.type) {
    case "string":
      return {
        kind: "string",
        constraints: valibotStringConstraints(schema),
      };
    case "number": {
      const { constraints, integer } = valibotNumberConstraints(schema);
      return {
        kind: "number",
        constraints,
        integer,
      };
    }
    case "boolean":
      return { kind: "boolean" };
    case "literal":
      return {
        kind: "literal",
        value: schema.literal,
      };
    case "picklist":
    case "enum":
      return literalUnion([...(schema.options ?? Object.values(schema.enum ?? {}))]);
    case "object":
      return {
        kind: "object",
        properties: objectPropertiesFromEntries(schema.entries ?? {}, unwrapValibotSchema),
      };
    case "array": {
      const { constraints } = valibotArrayConstraints(schema);
      return {
        kind: "array",
        item: valibotDescriptor(schema.item),
        constraints,
      };
    }
    case "tuple":
      return {
        kind: "tuple",
        items: (schema.items ?? []).map((item: any) => valibotDescriptor(item)),
      };
    case "union":
      return {
        kind: "union",
        options: (schema.options ?? []).map((option: any) => valibotDescriptor(option)),
      };
    case "nullable":
      return {
        kind: "union",
        options: [valibotDescriptor(schema.wrapped), { kind: "null" }],
      };
    case "null":
      return { kind: "null" };
    case "unknown":
    case "any":
      return { kind: "unknown" };
    default:
      return { kind: "unknown" };
  }
};

const valibotArrayConstraints = (schema: any) => {
  let constraints: FuzzConstraints | undefined;
  for (const step of schema?.pipe ?? []) {
    switch (step?.type) {
      case "min_length":
        if (typeof step.requirement === "number") {
          constraints = mergeConstraints(constraints, { minItems: step.requirement });
        }
        break;
      case "max_length":
        if (typeof step.requirement === "number") {
          constraints = mergeConstraints(constraints, { maxItems: step.requirement });
        }
        break;
    }
  }
  return { constraints };
};

const unwrapValibotSchema = (schema: any): { descriptor: TypeDescriptor; optional: boolean } => {
  let current = schema;
  let optional = false;

  while (current?.type === "optional" || current?.type === "exact_optional") {
    optional = true;
    current = current.wrapped;
  }

  if (current?.type === "nullish") {
    optional = true;
    return {
      descriptor: {
        kind: "union",
        options: [valibotDescriptor(current.wrapped), { kind: "null" }],
      },
      optional,
    };
  }

  return {
    descriptor: valibotDescriptor(current),
    optional,
  };
};

const SCHEMA_DESCRIPTOR_ADAPTERS: Record<string, SchemaDescriptorAdapter> = {
  valibot: {
    descriptorFromSchema: (schema) => valibotDescriptor(schema),
  },
  zod: {
    descriptorFromSchema: (schema) => zodDescriptor(schema),
  },
};

export const schemaSupportFromSchema = <Schema extends StandardSchemaLike>(
  schema: Schema,
): SchemaDescriptorSupport<Schema> => {
  if (!isStandardSchemaLike(schema)) {
    throw new Error("schema must implement StandardSchemaV1");
  }

  const standard = schema["~standard"];
  const normalizeSync = (value: unknown): NormalizedSchemaResult<SchemaOutput<Schema>> => {
    const result = standard.validate(value);
    if (result instanceof Promise) {
      throw new Error("async standard schema validation is not supported");
    }
    if (result.issues) {
      return {
        ok: false,
        issues: result.issues,
      };
    }
    return {
      ok: true,
      value: result.value,
    };
  };
  const validateSync = (value: unknown): value is SchemaInput<Schema> => normalizeSync(value).ok;

  const descriptor = SCHEMA_DESCRIPTOR_ADAPTERS[standard.vendor]?.descriptorFromSchema(schema);

  return {
    descriptor,
    normalizeSync,
    schema,
    validateSync,
    vendor: standard.vendor,
  };
};
