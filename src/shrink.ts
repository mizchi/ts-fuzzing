import {
  emitFuzzWarnings,
  normalizeFuzzValue,
  resolveFuzzData,
  type SchemaOptions,
  type SourceOptions,
} from "./fuzz_data.js";
import type { StandardSchemaLike } from "./schema.js";

export type ShrinkValueOptions<
  Input = unknown,
  Schema extends StandardSchemaLike = StandardSchemaLike,
> = SourceOptions &
  SchemaOptions<Schema> & {
    failureSignature?: (cause: unknown) => string;
    maxAttempts?: number;
    run: (input: Input) => unknown | Promise<unknown>;
    timeoutMs?: number;
    value: Input;
  };

export type ShrinkValueResult<Input = unknown> = {
  accepted: number;
  attempts: number;
  minimizedValue: Input;
  originalValue: Input;
  warnings: string[];
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function* shrinkArray<T>(value: readonly T[]): IterableIterator<T[]> {
  if (value.length === 0) {
    return;
  }
  yield [];
  if (value.length > 1) {
    yield value.slice(0, Math.floor(value.length / 2)) as T[];
    yield value.slice(Math.ceil(value.length / 2)) as T[];
  }
  for (let index = 0; index < value.length; index += 1) {
    yield [...value.slice(0, index), ...value.slice(index + 1)] as T[];
  }
  for (let index = 0; index < value.length; index += 1) {
    for (const sub of shrinkCandidates(value[index])) {
      yield [...value.slice(0, index), sub, ...value.slice(index + 1)] as T[];
    }
  }
}

function* shrinkObject(value: Record<string, unknown>): IterableIterator<Record<string, unknown>> {
  const keys = Object.keys(value);
  if (keys.length === 0) {
    return;
  }
  for (const key of keys) {
    const next: Record<string, unknown> = { ...value };
    delete next[key];
    yield next;
  }
  for (const key of keys) {
    for (const sub of shrinkCandidates(value[key])) {
      yield { ...value, [key]: sub };
    }
  }
}

function* shrinkString(value: string): IterableIterator<string> {
  if (value.length === 0) {
    return;
  }
  yield "";
  if (value.length > 1) {
    yield value.slice(0, Math.floor(value.length / 2));
    yield value.slice(Math.ceil(value.length / 2));
    yield value.slice(1);
    yield value.slice(0, -1);
  }
}

function* shrinkNumber(value: number): IterableIterator<number> {
  if (Number.isNaN(value)) {
    yield 0;
    return;
  }
  if (value === 0) {
    return;
  }
  yield 0;
  if (!Number.isInteger(value)) {
    const truncated = Math.trunc(value);
    if (truncated !== value) {
      yield truncated;
    }
  }
  if (Math.abs(value) > 1) {
    yield Math.trunc(value / 2);
  }
  if (value > 0) {
    yield value - 1;
  } else if (value < 0) {
    yield value + 1;
  }
}

function* shrinkMap(value: Map<unknown, unknown>): IterableIterator<Map<unknown, unknown>> {
  if (value.size === 0) {
    return;
  }
  yield new Map();
  const entries = [...value.entries()];
  for (let index = 0; index < entries.length; index += 1) {
    const next = new Map(entries);
    next.delete(entries[index][0]);
    yield next;
  }
}

function* shrinkSet(value: Set<unknown>): IterableIterator<Set<unknown>> {
  if (value.size === 0) {
    return;
  }
  yield new Set();
  const entries = [...value.values()];
  for (let index = 0; index < entries.length; index += 1) {
    const next = new Set(entries);
    next.delete(entries[index]);
    yield next;
  }
}

function* shrinkCandidates(value: unknown): IterableIterator<unknown> {
  if (value === null || value === undefined) {
    return;
  }
  if (Array.isArray(value)) {
    yield* shrinkArray(value);
    return;
  }
  if (value instanceof Map) {
    yield* shrinkMap(value);
    return;
  }
  if (value instanceof Set) {
    yield* shrinkSet(value);
    return;
  }
  if (value instanceof URL) {
    const text = value.href;
    for (const shorter of shrinkString(text)) {
      try {
        yield new URL(shorter || "about:blank");
      } catch {
        /* skip invalid URLs */
      }
    }
    return;
  }
  if (typeof value === "object") {
    yield* shrinkObject(value as Record<string, unknown>);
    return;
  }
  if (typeof value === "string") {
    yield* shrinkString(value);
    return;
  }
  if (typeof value === "number") {
    yield* shrinkNumber(value);
    return;
  }
  if (typeof value === "boolean") {
    if (value) {
      yield false;
    }
    return;
  }
  if (typeof value === "bigint") {
    if (value !== 0n) {
      yield 0n;
    }
    return;
  }
}

const runFailureSignature = (cause: unknown): string => {
  if (cause instanceof Error) {
    return `${cause.name}: ${cause.message}`;
  }
  return String(cause);
};

export const shrinkValue = async <Input = unknown>(
  options: ShrinkValueOptions<Input>,
): Promise<ShrinkValueResult<Input>> => {
  const resolved = options.sourcePath || options.schema ? resolveFuzzData(options) : undefined;
  if (resolved) {
    emitFuzzWarnings(resolved.warnings);
  }
  const schemaSupport = resolved?.schemaSupport;
  const warnings = resolved?.warnings ?? [];
  const maxAttempts = options.maxAttempts ?? 500;
  const deadline = options.timeoutMs ? Date.now() + options.timeoutMs : Infinity;
  const failureSignature = options.failureSignature ?? runFailureSignature;

  let baselineExecutionValue: unknown = options.value;
  if (schemaSupport) {
    const baselineNormalized = normalizeFuzzValue(options.value, schemaSupport);
    if (baselineNormalized.ok) {
      baselineExecutionValue = baselineNormalized.value;
    }
  }

  let baselineSignature: string | undefined;
  try {
    await options.run(baselineExecutionValue as Input);
    return {
      accepted: 0,
      attempts: 0,
      minimizedValue: options.value,
      originalValue: options.value,
      warnings: [...warnings, "[ts-fuzzing] shrinkValue: original value did not fail; returning as-is"],
    };
  } catch (cause) {
    baselineSignature = failureSignature(cause);
  }

  let current: unknown = options.value;
  if (schemaSupport) {
    const normalizedRoot = normalizeFuzzValue(current, schemaSupport);
    if (normalizedRoot.ok) {
      current = normalizedRoot.value;
    }
  }
  let attempts = 0;
  let accepted = 0;
  let progressed = true;

  while (progressed && attempts < maxAttempts && Date.now() < deadline) {
    progressed = false;
    for (const candidate of shrinkCandidates(current)) {
      if (attempts >= maxAttempts || Date.now() >= deadline) {
        break;
      }
      attempts += 1;
      let executionValue: unknown = candidate;
      if (schemaSupport) {
        const normalized = normalizeFuzzValue(candidate, schemaSupport);
        if (!normalized.ok) {
          continue;
        }
        executionValue = normalized.value;
      }
      try {
        await options.run(executionValue as Input);
      } catch (cause) {
        const candidateSignature = failureSignature(cause);
        if (candidateSignature === baselineSignature) {
          current = executionValue;
          accepted += 1;
          progressed = true;
          break;
        }
      }
    }
  }

  return {
    accepted,
    attempts,
    minimizedValue: current as Input,
    originalValue: options.value,
    warnings,
  };
};
