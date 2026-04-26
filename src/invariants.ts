import fc from "fast-check";
import { arbitraryFromDescriptor } from "./arbitrary.js";
import {
  emitFuzzWarnings,
  normalizeFuzzValue,
  resolveFuzzData,
  resolveInputDescriptor,
  type SchemaOptions,
  type SourceOptions,
} from "./fuzz_data.js";
import { ValueFuzzError, fuzzValues, type ValueFuzzOptions } from "./input_fuzz.js";
import type { StandardSchemaLike } from "./schema.js";

type BaseInvariantOptions<Input, Schema extends StandardSchemaLike> = Omit<
  ValueFuzzOptions<Input, Schema>,
  "run"
>;

export type RoundtripInvariantOptions<
  Input,
  Encoded,
  Schema extends StandardSchemaLike = StandardSchemaLike,
> = BaseInvariantOptions<Input, Schema> & {
  decode: (value: Encoded) => Input;
  encode: (value: Input) => Encoded;
  equals?: (a: Input, b: Input) => boolean;
};

export type IdempotentInvariantOptions<
  Input,
  Schema extends StandardSchemaLike = StandardSchemaLike,
> = BaseInvariantOptions<Input, Schema> & {
  apply: (value: Input) => Input;
  equals?: (a: Input, b: Input) => boolean;
};

export type CommutativeInvariantOptions<
  Input,
  Result,
  Schema extends StandardSchemaLike = StandardSchemaLike,
> = BaseInvariantOptions<Input, Schema> & {
  equals?: (a: Result, b: Result) => boolean;
  operation: (a: Input, b: Input) => Result | Promise<Result>;
};

export type AssociativeInvariantOptions<
  Input,
  Schema extends StandardSchemaLike = StandardSchemaLike,
> = BaseInvariantOptions<Input, Schema> & {
  equals?: (a: Input, b: Input) => boolean;
  operation: (a: Input, b: Input) => Input | Promise<Input>;
};

export type MonotonicInvariantOptions<
  Input,
  Output,
  Schema extends StandardSchemaLike = StandardSchemaLike,
> = BaseInvariantOptions<Input, Schema> & {
  compareInput?: (a: Input, b: Input) => number;
  compareOutput?: (a: Output, b: Output) => number;
  mapping: (value: Input) => Output | Promise<Output>;
};

const defaultEquals = <T>(a: T, b: T): boolean => {
  if (Object.is(a, b)) {
    return true;
  }
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
};

const defaultCompare = <T>(a: T, b: T): number => {
  if (Object.is(a, b)) {
    return 0;
  }
  const left = a as never;
  const right = b as never;
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
};

const formatValue = (value: unknown) => {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const resolveTupleArbitrary = <Input, Schema extends StandardSchemaLike>(
  options: BaseInvariantOptions<Input, Schema>,
) => {
  const resolved = resolveFuzzData(options);
  emitFuzzWarnings(resolved.warnings);
  const descriptor = resolveInputDescriptor(resolved.valueDescriptor, undefined);
  const base = arbitraryFromDescriptor(descriptor);
  const arbitrary = (
    resolved.schemaSupport
      ? base.filter((value) => resolved.schemaSupport!.normalizeSync(value).ok)
      : base
  ) as fc.Arbitrary<unknown>;
  const normalize = (candidate: unknown) => normalizeFuzzValue(candidate, resolved.schemaSupport);
  return { arbitrary, normalize, warnings: resolved.warnings };
};

const runTupleProperty = async <Input, Tuple extends unknown[]>(
  options: {
    numRuns?: number;
    perRunTimeoutMs?: number;
    seed?: number;
    timeoutMs?: number;
  },
  arbitrary: fc.Arbitrary<Tuple>,
  check: (values: Tuple) => void | Promise<void>,
  describeMessage: string,
  warnings: string[],
): Promise<void> => {
  let lastTuple: Tuple | undefined;
  try {
    await fc.assert(
      fc.asyncProperty(arbitrary, async (tuple) => {
        lastTuple = tuple;
        await check(tuple);
      }),
      {
        endOnFailure: true,
        interruptAfterTimeLimit: options.timeoutMs,
        markInterruptAsFailure: false,
        numRuns: options.numRuns ?? 100,
        seed: options.seed,
        timeout: options.perRunTimeoutMs,
      },
    );
  } catch (error) {
    throw new ValueFuzzError(describeMessage, {
      cause: error,
      failingValue: lastTuple,
      seed: options.seed,
      warnings,
    });
  }
};

export const fuzzRoundtrip = async <
  Input,
  Encoded,
  Schema extends StandardSchemaLike = StandardSchemaLike,
>(
  options: RoundtripInvariantOptions<Input, Encoded, Schema>,
): Promise<void> => {
  const { decode, encode, equals = defaultEquals, ...rest } = options;
  await fuzzValues<Input>({
    ...(rest as ValueFuzzOptions<Input, Schema>),
    run(value) {
      const encoded = encode(value);
      const decoded = decode(encoded);
      if (!equals(decoded, value)) {
        throw new Error(
          `roundtrip mismatch: decode(encode(${formatValue(value)})) = ${formatValue(decoded)}`,
        );
      }
    },
  });
};

export const fuzzIdempotent = async <
  Input,
  Schema extends StandardSchemaLike = StandardSchemaLike,
>(
  options: IdempotentInvariantOptions<Input, Schema>,
): Promise<void> => {
  const { apply, equals = defaultEquals, ...rest } = options;
  await fuzzValues<Input>({
    ...(rest as ValueFuzzOptions<Input, Schema>),
    run(value) {
      const once = apply(value);
      const twice = apply(once);
      if (!equals(once, twice)) {
        throw new Error(
          `not idempotent: apply(apply(${formatValue(value)})) = ${formatValue(twice)} !== ${formatValue(once)}`,
        );
      }
    },
  });
};

export const fuzzCommutative = async <
  Input,
  Result,
  Schema extends StandardSchemaLike = StandardSchemaLike,
>(
  options: CommutativeInvariantOptions<Input, Result, Schema>,
): Promise<void> => {
  const { equals = defaultEquals, operation, ...rest } = options;
  const { arbitrary, normalize, warnings } = resolveTupleArbitrary<Input, Schema>(rest);
  const pairArbitrary = fc.tuple(arbitrary, arbitrary);

  await runTupleProperty<Input, [unknown, unknown]>(
    options,
    pairArbitrary,
    async ([candA, candB]) => {
      const a = normalize(candA);
      const b = normalize(candB);
      if (!a.ok || !b.ok) {
        return;
      }
      const left = await operation(a.value as Input, b.value as Input);
      const right = await operation(b.value as Input, a.value as Input);
      if (!equals(left, right)) {
        throw new Error(
          `commutativity violated: op(${formatValue(a.value)}, ${formatValue(b.value)}) = ${formatValue(left)} !== op(b, a) = ${formatValue(right)}`,
        );
      }
    },
    "commutativity check failed",
    warnings,
  );
};

export const fuzzAssociative = async <
  Input,
  Schema extends StandardSchemaLike = StandardSchemaLike,
>(
  options: AssociativeInvariantOptions<Input, Schema>,
): Promise<void> => {
  const { equals = defaultEquals, operation, ...rest } = options;
  const { arbitrary, normalize, warnings } = resolveTupleArbitrary<Input, Schema>(rest);
  const tripleArbitrary = fc.tuple(arbitrary, arbitrary, arbitrary);

  await runTupleProperty<Input, [unknown, unknown, unknown]>(
    options,
    tripleArbitrary,
    async ([candA, candB, candC]) => {
      const a = normalize(candA);
      const b = normalize(candB);
      const c = normalize(candC);
      if (!a.ok || !b.ok || !c.ok) {
        return;
      }
      const left = await operation(
        (await operation(a.value as Input, b.value as Input)) as Input,
        c.value as Input,
      );
      const right = await operation(
        a.value as Input,
        (await operation(b.value as Input, c.value as Input)) as Input,
      );
      if (!equals(left, right)) {
        throw new Error(
          `associativity violated: op(op(a,b),c) = ${formatValue(left)} !== op(a,op(b,c)) = ${formatValue(right)}`,
        );
      }
    },
    "associativity check failed",
    warnings,
  );
};

export const fuzzMonotonic = async <
  Input,
  Output,
  Schema extends StandardSchemaLike = StandardSchemaLike,
>(
  options: MonotonicInvariantOptions<Input, Output, Schema>,
): Promise<void> => {
  const {
    compareInput = defaultCompare,
    compareOutput = defaultCompare,
    mapping,
    ...rest
  } = options;
  const { arbitrary, normalize, warnings } = resolveTupleArbitrary<Input, Schema>(rest);
  const pairArbitrary = fc.tuple(arbitrary, arbitrary);

  await runTupleProperty<Input, [unknown, unknown]>(
    options,
    pairArbitrary,
    async ([candA, candB]) => {
      const a = normalize(candA);
      const b = normalize(candB);
      if (!a.ok || !b.ok) {
        return;
      }
      const inputOrder = compareInput(a.value as Input, b.value as Input);
      const [mappedA, mappedB] = await Promise.all([
        mapping(a.value as Input),
        mapping(b.value as Input),
      ]);
      const outputOrder = compareOutput(mappedA, mappedB);
      if (Math.sign(inputOrder) !== Math.sign(outputOrder) && inputOrder !== 0 && outputOrder !== 0) {
        throw new Error(
          `monotonicity violated: compare(a,b) = ${inputOrder} but compare(map(a), map(b)) = ${outputOrder} (a=${formatValue(a.value)}, b=${formatValue(b.value)})`,
        );
      }
      if (inputOrder !== 0 && outputOrder === 0) {
        // strictly monotonic? we allow non-strict: equal outputs are fine only if inputs are equal.
        // Here inputs differ but outputs equal → weakly monotonic, not an error.
        return;
      }
      if (inputOrder === 0 && outputOrder !== 0) {
        throw new Error(
          `equal inputs produced different outputs: map(${formatValue(a.value)}) = ${formatValue(mappedA)} vs map(${formatValue(b.value)}) = ${formatValue(mappedB)}`,
        );
      }
    },
    "monotonicity check failed",
    warnings,
  );
};
