import fc from "fast-check";
import type { Arbitrary } from "fast-check";
import type { FuzzConstraints } from "./descriptor.js";

const repeated = (char: string, length: number) => char.repeat(Math.max(0, length));

const filterByLength = (values: string[], constraints: FuzzConstraints | undefined) => {
  return values.filter((value) => {
    const minLength = constraints?.minLength;
    const maxLength = constraints?.maxLength;
    if (minLength !== undefined && value.length < minLength) {
      return false;
    }
    if (maxLength !== undefined && value.length > maxLength) {
      return false;
    }
    return true;
  });
};

export const domainBoundaryStrings = (constraints: FuzzConstraints | undefined): string[] | undefined => {
  switch (constraints?.pattern) {
    case "email":
      return filterByLength(
        [
          "a@b.co",
          "edge.user@example.com",
          "long.user+tag@example-domain.test",
        ],
        constraints,
      );
    case "url":
      return filterByLength(
        [
          "https://example.com",
          "https://example.com/path?q=1",
          "http://localhost:3000/dev",
        ],
        constraints,
      );
    default:
      return undefined;
  }
};

export const domainStringArbitrary = (
  constraints: FuzzConstraints | undefined,
): Arbitrary<string> | undefined => {
  switch (constraints?.pattern) {
    case "email":
      return fc
        .tuple(fc.integer({ min: 1, max: 9999 }), fc.integer({ min: 1, max: 9999 }))
        .map(([user, host]) => `user${user}@example${host}.com`)
        .filter((value) => filterByLength([value], constraints).length > 0);
    case "url":
      return fc
        .tuple(
          fc.constantFrom("https", "http"),
          fc.integer({ min: 1, max: 9999 }),
          fc.integer({ min: 1, max: 9999 }),
        )
        .map(([protocol, host, path]) => `${protocol}://example${host}.test/p/${path}`)
        .filter((value) => filterByLength([value], constraints).length > 0);
    default:
      return undefined;
  }
};

export const genericBoundaryStrings = (constraints: FuzzConstraints | undefined): string[] => {
  const minLength = constraints?.minLength ?? 0;
  const maxLength = Math.max(minLength, constraints?.maxLength ?? Math.max(minLength, 8));
  const lengths = new Set<number>([
    minLength,
    Math.min(maxLength, minLength + 1),
    Math.max(minLength, maxLength - 1),
    maxLength,
  ]);

  return [...lengths]
    .filter((length) => length >= minLength && length <= maxLength)
    .sort((left, right) => left - right)
    .map((length) => repeated("a", length));
};

export const regexBoundaryStrings = (constraints: FuzzConstraints | undefined): string[] => {
  if (!constraints?.pattern || constraints.pattern === "email" || constraints.pattern === "url") {
    return [];
  }
  const seeds = [1, 2, 3, 4];
  const values = seeds.map((seed) =>
    fc.sample(fc.stringMatching(new RegExp(constraints.pattern!)), {
      numRuns: 1,
      seed,
    })[0] ?? "",
  );
  return filterByLength(values, constraints);
};
