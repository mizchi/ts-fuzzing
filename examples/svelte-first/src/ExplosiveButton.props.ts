import type { MinLength } from "ts-fuzzing";

export interface ExplosiveButtonProps {
  label: string & MinLength<1>;
  mode: "safe" | "explode";
}
