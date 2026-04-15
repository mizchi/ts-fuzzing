import fc from "fast-check";
import type { Arbitrary } from "fast-check";
import type { FuzzConstraints } from "./descriptor.js";

const repeated = (char: string, length: number) => char.repeat(Math.max(0, length));

const ulidAlphabet = [..."0123456789ABCDEFGHJKMNPQRSTVWXYZ"];

const fixedHex = (length: number) =>
  fc
    .array(fc.integer({ min: 0, max: 15 }), { minLength: length, maxLength: length })
    .map((digits) => digits.map((digit) => digit.toString(16)).join(""));

const fixedUlid = () =>
  fc
    .array(fc.constantFrom(...ulidAlphabet), { minLength: 26, maxLength: 26 })
    .map((chars) => chars.join(""));

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
    case "uuid":
      return filterByLength(
        [
          "00000000-0000-4000-8000-000000000000",
          "123e4567-e89b-42d3-a456-426614174000",
        ],
        constraints,
      );
    case "ulid":
      return filterByLength(
        [
          "01ARZ3NDEKTSV4RRFFQ69G5FAV",
          "01BX5ZZKBKACTAV9WEVGEMMVS0",
        ],
        constraints,
      );
    case "iso-date":
      return filterByLength(
        [
          "1970-01-01T00:00:00.000Z",
          "2000-01-01T00:00:00.000Z",
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
    case "uuid":
      return fc
        .tuple(
          fixedHex(8),
          fixedHex(4),
          fixedHex(3),
          fc.constantFrom("8", "9", "a", "b"),
          fixedHex(3),
          fixedHex(12),
        )
        .map(([left, mid, versionTail, variant, variantTail, right]) =>
          `${left}-${mid}-4${versionTail}-${variant}${variantTail}-${right}`,
        )
        .filter((value) => filterByLength([value], constraints).length > 0);
    case "ulid":
      return fixedUlid().filter((value) => filterByLength([value], constraints).length > 0);
    case "iso-date":
      return fc
        .date({
          min: new Date("1970-01-01T00:00:00.000Z"),
          max: new Date("2099-12-31T23:59:59.999Z"),
        })
        .map((value) => value.toISOString())
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
  if (
    !constraints?.pattern ||
    constraints.pattern === "email" ||
    constraints.pattern === "url" ||
    constraints.pattern === "uuid" ||
    constraints.pattern === "ulid" ||
    constraints.pattern === "iso-date"
  ) {
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
