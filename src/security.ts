import fc from "fast-check";
import type { Pattern } from "./fuzz_markers.js";
import { xssCorpus, xssCorpusByCategory, type XssCorpusCategory } from "./security_corpus.js";

export type XssPayload = Pattern<"xss">;

export const xssPayloads: fc.Arbitrary<string> = fc.constantFrom(...xssCorpus);

export const xssPayloadsByCategory = (category: XssCorpusCategory): fc.Arbitrary<string> => {
  return fc.constantFrom(...xssCorpusByCategory[category]);
};

export { xssCorpus, xssCorpusByCategory } from "./security_corpus.js";
export type { XssCorpusCategory } from "./security_corpus.js";
