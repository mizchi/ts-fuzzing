export type StringOrNumber<T> = T extends string
  ? { kind: "string"; value: T }
  : { kind: "number"; value: number };

export type ConcreteConditional = StringOrNumber<"x">;
export type DistributedConditional = StringOrNumber<"x" | 1>;

export type Wrapped<T extends string | number[]> = T extends string
  ? { value: T }
  : { items: T };

export type WrappedGeneric<T extends string | number[]> = Wrapped<T>;

export type InferArray<T> = T extends Array<infer U>
  ? { item: U }
  : { raw: T };

export type InferGeneric<T> = InferArray<T>;
