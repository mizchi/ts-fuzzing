export interface SvelteBombProps {
  /** @fuzz.minLength 1 */
  label: string;
  mode?: "safe" | "explode";
}
