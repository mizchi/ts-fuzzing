export type BoundaryWidgetProps = {
  /**
   * @fuzz.minLength 1
   * @fuzz.maxLength 4
   */
  label: string;
  /**
   * @fuzz.min 0
   * @fuzz.max 2
   */
  count: number;
  variant: "safe" | "danger";
};

export const BoundaryWidget = ({ label, count, variant }: BoundaryWidgetProps) => {
  if (count === 2 && label.length === 4 && variant === "danger") {
    throw new Error("boundary exploded");
  }
  return (
    <div data-variant={variant}>
      {label}:{count}
    </div>
  );
};
