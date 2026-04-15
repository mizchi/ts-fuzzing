export declare const TS_FUZZING_HINT: unique symbol;

export type Fuzz<Tag extends string, Value = true> = {
  readonly [TS_FUZZING_HINT]?: {
    readonly tag: Tag;
    readonly value: Value;
  };
};

export type Pattern<Name extends string> = Fuzz<"pattern", Name>;

export type UUID = Pattern<"uuid">;
export type ULID = Pattern<"ulid">;
export type ISODateString = Pattern<"iso-date">;

export type Int = Fuzz<"int">;
export type Float = Fuzz<"float">;
export type Double = Float;

export type Min<N extends number> = Fuzz<"min", N>;
export type Max<N extends number> = Fuzz<"max", N>;
export type MinLength<N extends number> = Fuzz<"minLength", N>;
export type MaxLength<N extends number> = Fuzz<"maxLength", N>;
export type MinItems<N extends number> = Fuzz<"minItems", N>;
export type MaxItems<N extends number> = Fuzz<"maxItems", N>;
