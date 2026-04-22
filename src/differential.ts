import { fuzzValues, type ValueFuzzOptions } from "./input_fuzz.js";
import type { StandardSchemaLike } from "./schema.js";

type BaseOptions<Input, Schema extends StandardSchemaLike> = Omit<
  ValueFuzzOptions<Input, Schema>,
  "run"
>;

export type DifferentialFuzzOptions<
  Input,
  Result,
  Schema extends StandardSchemaLike = StandardSchemaLike,
> = BaseOptions<Input, Schema> & {
  equals?: (a: Result, b: Result) => boolean;
  implementations: readonly [
    (value: Input) => Result | Promise<Result>,
    (value: Input) => Result | Promise<Result>,
  ];
  names?: readonly [string, string];
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

export const fuzzDifferential = async <
  Input,
  Result,
  Schema extends StandardSchemaLike = StandardSchemaLike,
>(
  options: DifferentialFuzzOptions<Input, Result, Schema>,
): Promise<void> => {
  const { equals = defaultEquals, implementations, names = ["implA", "implB"], ...rest } = options;
  const [left, right] = implementations;
  const [leftName, rightName] = names;
  await fuzzValues<Input>({
    ...(rest as ValueFuzzOptions<Input, Schema>),
    async run(value) {
      const [leftResult, rightResult] = await Promise.all([left(value), right(value)]);
      if (!equals(leftResult, rightResult)) {
        throw new Error(
          `${leftName} and ${rightName} disagree: ${formatValue(leftResult)} !== ${formatValue(rightResult)}`,
        );
      }
    },
  });
};
