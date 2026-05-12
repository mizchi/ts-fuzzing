export type DecimalSlot = {
  amount: Decimal;
  label: string;
};

// A stand-in for an SDK-specific class instance whose type the analyzer would
// otherwise expand into a giant object descriptor.
export type Decimal = {
  add(other: Decimal): Decimal;
  toFixed(places: number): string;
  value: number;
  exponent: number;
  mantissa: number;
};
