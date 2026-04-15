import { fileURLToPath } from "node:url";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import fc from "fast-check";
import { analyzeTypeInfo } from "./analyzer.js";
import { arbitraryFromDescriptor } from "./arbitrary.js";
import { boundaryValuesFromDescriptor } from "./boundary.js";
import type { TypeDescriptor } from "./descriptor.js";
import type { StandardSchemaLike } from "./schema.js";
import { schemaSupportFromSchema } from "./schema.js";

type SchemaOutput<Schema extends StandardSchemaLike> = StandardSchemaV1.InferOutput<Schema>;

export type SourceOptions = {
  sourcePath?: string | URL;
  exportName?: string;
  typeName?: string;
};

export type SchemaOptions<Schema extends StandardSchemaLike = StandardSchemaLike> = {
  schema?: Schema;
};

export type InputDescriptorTransform = (inputDescriptor: TypeDescriptor) => TypeDescriptor;

type DescribeInputCarrier =
  | {
      describeInput?: InputDescriptorTransform;
      render?: unknown;
    }
  | ((input: unknown) => unknown | Promise<unknown>);
export type ResolvedFuzzData = {
  componentDescriptor: TypeDescriptor;
  valueDescriptor: TypeDescriptor;
  schemaSupport?: ReturnType<typeof schemaSupportFromSchema>;
  sourcePath: string | undefined;
  warnings: string[];
};

type SourceBackedOptions = SourceOptions & {
  sourcePath: string | URL;
};

const normalizePath = (sourcePath: string | URL) => {
  if (sourcePath instanceof URL) {
    return fileURLToPath(sourcePath);
  }
  return sourcePath;
};

export const resolveInputDescriptor = (
  valueDescriptor: TypeDescriptor,
  describeInput: InputDescriptorTransform | undefined,
) => {
  if (!describeInput) {
    return valueDescriptor;
  }
  return describeInput(valueDescriptor);
};

export const resolveFuzzData = (
  options: SourceOptions & SchemaOptions,
): ResolvedFuzzData => {
  const schemaSupport = options.schema ? schemaSupportFromSchema(options.schema) : undefined;

  if (options.sourcePath) {
    const normalizedPath = normalizePath(options.sourcePath);
    const analyzed = analyzeTypeInfo({
      exportName: options.exportName,
      typeName: options.typeName,
      sourcePath: normalizedPath,
    });
    return {
      componentDescriptor: analyzed.descriptor,
      valueDescriptor: analyzed.descriptor,
      schemaSupport,
      sourcePath: normalizedPath,
      warnings: analyzed.warnings,
    };
  }

  if (schemaSupport?.descriptor) {
    return {
      componentDescriptor: schemaSupport.descriptor,
      valueDescriptor: schemaSupport.descriptor,
      schemaSupport,
      sourcePath: undefined,
      warnings: [],
    };
  }

  if (options.schema) {
    throw new Error(
      `schema vendor "${schemaSupport?.vendor ?? "unknown"}" cannot generate values directly. pass sourcePath to use TypeScript types as the base shape`,
    );
  }

  throw new Error("sourcePath or schema is required");
};

export const normalizeFuzzValue = (
  value: unknown,
  schemaSupport: ReturnType<typeof schemaSupportFromSchema> | undefined,
) => {
  if (!schemaSupport) {
    return {
      ok: true as const,
      value,
    };
  }
  return schemaSupport.normalizeSync(value);
};

export const emitFuzzWarnings = (warnings: readonly string[]) => {
  for (const warning of warnings) {
    process.emitWarning(warning);
  }
};

const normalizeFuzzValues = <Value>(
  values: readonly Value[],
  schemaSupport: ReturnType<typeof schemaSupportFromSchema> | undefined,
) => {
  if (!schemaSupport) {
    return values.map((value) => ({
      normalized: value,
      raw: value,
    }));
  }
  const normalized: Array<{ normalized: unknown; raw: Value }> = [];
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

export const sampleFuzzData = (
  resolved: ResolvedFuzzData,
  options: {
    describeInput?: InputDescriptorTransform;
    numRuns: number;
    seed?: number;
  },
) => {
  const descriptor = resolveInputDescriptor(resolved.valueDescriptor, options.describeInput);

  if (!resolved.schemaSupport) {
    return fc.sample(arbitraryFromDescriptor(descriptor), {
      numRuns: options.numRuns,
      seed: options.seed,
    }) as unknown[];
  }

  const values: unknown[] = [];
  let batchSeed = options.seed;
  let attempts = 0;

  while (values.length < options.numRuns && attempts < options.numRuns * 16) {
    const batch = fc.sample(arbitraryFromDescriptor(descriptor), {
      numRuns: Math.max(options.numRuns * 2, 16),
      seed: batchSeed,
    });
    for (const value of batch) {
      const result = resolved.schemaSupport.normalizeSync(value);
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
    throw new Error("failed to generate enough valid values from descriptor and schema");
  }

  return values;
};

export const sampleBoundaryFuzzData = (
  resolved: ResolvedFuzzData,
  options: {
    describeInput?: InputDescriptorTransform;
    maxCases: number;
  },
) => {
  const descriptor = resolveInputDescriptor(resolved.valueDescriptor, options.describeInput);
  const rawCases = boundaryValuesFromDescriptor(descriptor, options.maxCases);
  const cases = normalizeFuzzValues(rawCases, resolved.schemaSupport);
  if (rawCases.length > 0 && cases.length === 0 && resolved.schemaSupport) {
    throw new Error("schema filtering removed every boundary case");
  }
  return cases.map((entry) => entry.normalized);
};

export function sampleValues<Schema extends StandardSchemaLike>(
  options: { schema: Schema; sourcePath?: undefined; numRuns?: number; seed?: number },
): Promise<Array<SchemaOutput<Schema>>>;
export function sampleValues<Input = Record<string, any>>(
  options: SourceBackedOptions & { numRuns?: number; seed?: number; schema?: StandardSchemaLike },
): Promise<Array<Input>>;
export async function sampleValues(
  options: SourceOptions & { numRuns?: number; seed?: number; schema?: StandardSchemaLike },
): Promise<Array<Record<string, any>>> {
  const resolved = resolveFuzzData(options);
  emitFuzzWarnings(resolved.warnings);
  return sampleFuzzData(resolved, {
    numRuns: options.numRuns ?? 10,
    seed: options.seed,
  }) as Array<Record<string, any>>;
}

export function sampleBoundaryValues<Schema extends StandardSchemaLike>(
  options: {
    describeInput?: InputDescriptorTransform;
    maxCases?: number;
    schema: Schema;
    sourcePath?: undefined;
  },
): Promise<Array<SchemaOutput<Schema>>>;
export function sampleBoundaryValues<Input = Record<string, any>>(
  options: SourceBackedOptions & {
    describeInput?: InputDescriptorTransform;
    maxCases?: number;
    render?: DescribeInputCarrier;
    schema?: StandardSchemaLike;
  },
): Promise<Array<Input>>;
export async function sampleBoundaryValues(
  options: SourceOptions & {
    describeInput?: InputDescriptorTransform;
    maxCases?: number;
    render?: DescribeInputCarrier;
    schema?: StandardSchemaLike;
  },
): Promise<Array<Record<string, any>>> {
  const resolved = resolveFuzzData(options);
  emitFuzzWarnings(resolved.warnings);
  return sampleBoundaryFuzzData(resolved, {
    describeInput:
      options.describeInput ??
      (typeof options.render === "function" ? undefined : options.render?.describeInput),
    maxCases: options.maxCases ?? 64,
  }) as Array<Record<string, any>>;
}

export const sampleValuesFromSchema = async <Schema extends StandardSchemaLike>(
  options: { schema: Schema; numRuns?: number; seed?: number },
): Promise<Array<SchemaOutput<Schema>>> => {
  return sampleValues(options);
};

export const sampleBoundaryValuesFromSchema = async <Schema extends StandardSchemaLike>(
  options: { schema: Schema; maxCases?: number },
): Promise<Array<SchemaOutput<Schema>>> => {
  return sampleBoundaryValues(options);
};

export function sampleProps<Schema extends StandardSchemaLike>(
  options: { schema: Schema; sourcePath?: undefined; numRuns?: number; seed?: number },
): Promise<Array<SchemaOutput<Schema>>>;
export function sampleProps<Props = Record<string, any>>(
  options: SourceBackedOptions & { numRuns?: number; seed?: number; schema?: StandardSchemaLike },
): Promise<Array<Props>>;
export async function sampleProps(
  options: SourceOptions & { numRuns?: number; seed?: number; schema?: StandardSchemaLike },
): Promise<Array<Record<string, any>>> {
  return sampleValues(options as any) as Promise<Array<Record<string, any>>>;
}

export function sampleBoundaryProps<Schema extends StandardSchemaLike>(
  options: {
    describeInput?: InputDescriptorTransform;
    maxCases?: number;
    schema: Schema;
    sourcePath?: undefined;
  },
): Promise<Array<SchemaOutput<Schema>>>;
export function sampleBoundaryProps<Props = Record<string, any>>(
  options: SourceBackedOptions & {
    describeInput?: InputDescriptorTransform;
    maxCases?: number;
    render?: DescribeInputCarrier;
    schema?: StandardSchemaLike;
  },
): Promise<Array<Props>>;
export async function sampleBoundaryProps(
  options: SourceOptions & {
    describeInput?: InputDescriptorTransform;
    maxCases?: number;
    render?: DescribeInputCarrier;
    schema?: StandardSchemaLike;
  },
): Promise<Array<Record<string, any>>> {
  return sampleBoundaryValues(options as any) as Promise<Array<Record<string, any>>>;
}

export const samplePropsFromSchema = async <Schema extends StandardSchemaLike>(
  options: { schema: Schema; numRuns?: number; seed?: number },
): Promise<Array<SchemaOutput<Schema>>> => {
  return sampleValuesFromSchema(options);
};

export const sampleBoundaryPropsFromSchema = async <Schema extends StandardSchemaLike>(
  options: { schema: Schema; maxCases?: number },
): Promise<Array<SchemaOutput<Schema>>> => {
  return sampleBoundaryValuesFromSchema(options);
};
