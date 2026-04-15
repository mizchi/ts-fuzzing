import type {
  Float,
  ISODateString,
  Int,
  Max,
  MaxItems,
  MaxLength,
  Min,
  MinItems,
  MinLength,
  Pattern,
  ULID,
  UUID,
} from "ts-fuzzing";

export type FuzzHints = {
  id: string & UUID;
  token: string & ULID;
  createdAt: string & ISODateString;
  email: string & Pattern<"email">;
  score: number & Int & Min<0> & Max<10>;
  ratio: number & Float & Min<0> & Max<1>;
  title: string & MinLength<2> & MaxLength<4>;
  tags: string[] & MinItems<1> & MaxItems<2>;
};

export type BareHint = UUID;
