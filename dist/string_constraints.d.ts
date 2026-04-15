import type { Arbitrary } from "fast-check";
import type { FuzzConstraints } from "./descriptor.js";
export declare const domainBoundaryStrings: (constraints: FuzzConstraints | undefined) => string[] | undefined;
export declare const domainStringArbitrary: (constraints: FuzzConstraints | undefined) => Arbitrary<string> | undefined;
export declare const genericBoundaryStrings: (constraints: FuzzConstraints | undefined) => string[];
export declare const regexBoundaryStrings: (constraints: FuzzConstraints | undefined) => string[];
//# sourceMappingURL=string_constraints.d.ts.map