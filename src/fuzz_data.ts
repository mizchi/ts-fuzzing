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
export type FuzzValueIterator<Value = unknown> = AsyncIterableIterator<Value>;

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

const nextSeed = (seed: number | undefined, offset: number) => {
  if (seed === undefined) {
    return undefined;
  }
  return seed + offset;
};

const sampleSingleValue = <Value>(
  arbitrary: fc.Arbitrary<Value>,
  seed: number | undefined,
) => {
  return fc.sample(arbitrary, {
    numRuns: 1,
    seed,
  })[0];
};

export const sampleFuzzData = (
  resolved: ResolvedFuzzData,
  options: {
    describeInput?: InputDescriptorTransform;
    numRuns: number;
    seed?: number;
  },
): FuzzValueIterator<unknown> => {
  const descriptor = resolveInputDescriptor(resolved.valueDescriptor, options.describeInput);
  const arbitrary = arbitraryFromDescriptor(descriptor) as fc.Arbitrary<unknown>;

  return (async function* () {
    if (!resolved.schemaSupport) {
      for (let index = 0; index < options.numRuns; index += 1) {
        yield sampleSingleValue(arbitrary, nextSeed(options.seed, index));
      }
      return;
    }

    let yielded = 0;
    let attempts = 0;
    const maxAttempts = options.numRuns * 16;

    while (yielded < options.numRuns && attempts < maxAttempts) {
      const candidate = sampleSingleValue(arbitrary, nextSeed(options.seed, attempts));
      attempts += 1;
      const result = resolved.schemaSupport.normalizeSync(candidate);
      if (!result.ok) {
        continue;
      }
      yielded += 1;
      yield result.value;
    }

    if (yielded < options.numRuns) {
      throw new Error("failed to generate enough valid values from descriptor and schema");
    }
  })();
};

export const sampleBoundaryFuzzData = (
  resolved: ResolvedFuzzData,
  options: {
    describeInput?: InputDescriptorTransform;
    maxCases: number;
  },
): FuzzValueIterator<unknown> => {
  const descriptor = resolveInputDescriptor(resolved.valueDescriptor, options.describeInput);
  return (async function* () {
    const rawCases = boundaryValuesFromDescriptor(descriptor, options.maxCases);
    const cases = normalizeFuzzValues(rawCases, resolved.schemaSupport);
    if (rawCases.length > 0 && cases.length === 0 && resolved.schemaSupport) {
      throw new Error("schema filtering removed every boundary case");
    }
    for (const entry of cases) {
      yield entry.normalized;
    }
  })();
};

export function sampleValues<Schema extends StandardSchemaLike>(
  options: { schema: Schema; sourcePath?: undefined; numRuns?: number; seed?: number },
): FuzzValueIterator<SchemaOutput<Schema>>;
export function sampleValues<Input = Record<string, any>>(
  options: SourceBackedOptions & { numRuns?: number; seed?: number; schema?: StandardSchemaLike },
): FuzzValueIterator<Input>;
export function sampleValues(
  options: SourceOptions & { numRuns?: number; seed?: number; schema?: StandardSchemaLike },
): FuzzValueIterator<Record<string, any>> {
  return (async function* () {
    const resolved = resolveFuzzData(options);
    emitFuzzWarnings(resolved.warnings);
    for await (const value of sampleFuzzData(resolved, {
      numRuns: options.numRuns ?? 10,
      seed: options.seed,
    })) {
      yield value as Record<string, any>;
    }
  })();
}

export function sampleBoundaryValues<Schema extends StandardSchemaLike>(
  options: {
    describeInput?: InputDescriptorTransform;
    maxCases?: number;
    schema: Schema;
    sourcePath?: undefined;
  },
): FuzzValueIterator<SchemaOutput<Schema>>;
export function sampleBoundaryValues<Input = Record<string, any>>(
  options: SourceBackedOptions & {
    describeInput?: InputDescriptorTransform;
    maxCases?: number;
    render?: DescribeInputCarrier;
    schema?: StandardSchemaLike;
  },
): FuzzValueIterator<Input>;
export function sampleBoundaryValues(
  options: SourceOptions & {
    describeInput?: InputDescriptorTransform;
    maxCases?: number;
    render?: DescribeInputCarrier;
    schema?: StandardSchemaLike;
  },
): FuzzValueIterator<Record<string, any>> {
  return (async function* () {
    const resolved = resolveFuzzData(options);
    emitFuzzWarnings(resolved.warnings);
    for await (const value of sampleBoundaryFuzzData(resolved, {
      describeInput:
        options.describeInput ??
        (typeof options.render === "function" ? undefined : options.render?.describeInput),
      maxCases: options.maxCases ?? 64,
    })) {
      yield value as Record<string, any>;
    }
  })();
}

export const sampleValuesFromSchema = <Schema extends StandardSchemaLike>(
  options: { schema: Schema; numRuns?: number; seed?: number },
): FuzzValueIterator<SchemaOutput<Schema>> => {
  return sampleValues(options);
};

export const sampleBoundaryValuesFromSchema = <Schema extends StandardSchemaLike>(
  options: { schema: Schema; maxCases?: number },
): FuzzValueIterator<SchemaOutput<Schema>> => {
  return sampleBoundaryValues(options);
};

export function sampleProps<Schema extends StandardSchemaLike>(
  options: { schema: Schema; sourcePath?: undefined; numRuns?: number; seed?: number },
): FuzzValueIterator<SchemaOutput<Schema>>;
export function sampleProps<Props = Record<string, any>>(
  options: SourceBackedOptions & { numRuns?: number; seed?: number; schema?: StandardSchemaLike },
): FuzzValueIterator<Props>;
export function sampleProps(
  options: SourceOptions & { numRuns?: number; seed?: number; schema?: StandardSchemaLike },
): FuzzValueIterator<Record<string, any>> {
  return sampleValues(options as any) as FuzzValueIterator<Record<string, any>>;
}

export function sampleBoundaryProps<Schema extends StandardSchemaLike>(
  options: {
    describeInput?: InputDescriptorTransform;
    maxCases?: number;
    schema: Schema;
    sourcePath?: undefined;
  },
): FuzzValueIterator<SchemaOutput<Schema>>;
export function sampleBoundaryProps<Props = Record<string, any>>(
  options: SourceBackedOptions & {
    describeInput?: InputDescriptorTransform;
    maxCases?: number;
    render?: DescribeInputCarrier;
    schema?: StandardSchemaLike;
  },
): FuzzValueIterator<Props>;
export function sampleBoundaryProps(
  options: SourceOptions & {
    describeInput?: InputDescriptorTransform;
    maxCases?: number;
    render?: DescribeInputCarrier;
    schema?: StandardSchemaLike;
  },
): FuzzValueIterator<Record<string, any>> {
  return sampleBoundaryValues(options as any) as FuzzValueIterator<Record<string, any>>;
}

export const samplePropsFromSchema = <Schema extends StandardSchemaLike>(
  options: { schema: Schema; numRuns?: number; seed?: number },
): FuzzValueIterator<SchemaOutput<Schema>> => {
  return sampleValuesFromSchema(options);
};

export const sampleBoundaryPropsFromSchema = <Schema extends StandardSchemaLike>(
  options: { schema: Schema; maxCases?: number },
): FuzzValueIterator<SchemaOutput<Schema>> => {
  return sampleBoundaryValuesFromSchema(options);
};
