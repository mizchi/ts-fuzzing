import type { ReactNode } from "react";

export type ButtonProps = {
  /**
   * @fuzz.minLength 1
   * @fuzz.maxLength 16
   */
  label: string;
  variant: "primary" | "ghost";
  disabled?: boolean;
  children?: ReactNode;
  onClick?: () => void;
};

export const Button = ({ label, variant, disabled = false }: ButtonProps) => {
  return (
    <button data-variant={variant} disabled={disabled}>
      {label}
    </button>
  );
};
