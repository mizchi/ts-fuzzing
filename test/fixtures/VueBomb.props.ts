export interface VueBombProps {
  /** @fuzz.minLength 1 */
  label: string;
  mode?: "safe" | "explode";
}
