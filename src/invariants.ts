import { fuzzValues, type ValueFuzzOptions } from "./input_fuzz.js";
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

const formatValue = (value: unknown) => {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
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
