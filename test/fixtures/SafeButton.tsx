import type { ReactNode } from "react";

export type SafeButtonProps = {
  /**
   * @fuzz.minLength 1
   * @fuzz.maxLength 16
   */
  label: string;
  /**
   * @fuzz.min 0
   * @fuzz.max 5
   */
  count?: number;
  variant: "primary" | "ghost";
  disabled?: boolean;
  children?: ReactNode;
  onClick?: () => void;
};

export const SafeButton = ({ label, count = 0, variant, disabled = false }: SafeButtonProps) => {
  return (
    <button data-variant={variant} disabled={disabled}>
      {label}:{count}
    </button>
  );
};
