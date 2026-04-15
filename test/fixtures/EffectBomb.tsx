import { useEffect } from "react";

export type EffectBombProps = {
  mode: "safe" | "explode";
};

export const EffectBomb = ({ mode }: EffectBombProps) => {
  useEffect(() => {
    if (mode === "explode") {
      throw new Error("effect exploded");
    }
  }, [mode]);

  return <div>{mode}</div>;
};
