import type { Int, Max, Min } from "ts-fuzzing";

export type PriceTagProps = {
  currency: "JPY" | "USD";
  amount: number & Int & Min<0> & Max<9999>;
};
