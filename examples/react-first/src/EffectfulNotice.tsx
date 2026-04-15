import { useEffect } from "react";

export type EffectfulNoticeProps = {
  /**
   * @fuzz.minLength 1
   * @fuzz.maxLength 16
   */
  message: string;
  mode: "safe" | "danger";
};

export const EffectfulNotice = ({ message, mode }: EffectfulNoticeProps) => {
  useEffect(() => {
    if (mode === "danger") {
      throw new Error(`effect exploded:${message}`);
    }
  }, [message, mode]);

  return <div>{message}</div>;
};
