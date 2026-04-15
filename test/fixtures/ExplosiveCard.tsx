export type ExplosiveCardProps = {
  title: string;
  variant: "safe" | "danger";
  /**
   * @fuzz.minItems 1
   */
  items: string[];
};

export const ExplosiveCard = ({ title, variant, items }: ExplosiveCardProps) => {
  if (variant === "danger" && items.length > 0) {
    throw new Error(`boom:${title}`);
  }
  return <section>{title}</section>;
};
