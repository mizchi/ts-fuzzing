import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { analyzePropsDescriptor, analyzeTypeDescriptor } from "../src/analyzer.js";
import { resolveFuzzData } from "../src/index.js";

const tempDirs: string[] = [];

const writeTempFile = (name: string, content: string) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-fuzzing-analyzer-"));
  tempDirs.push(dir);
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, content);
  return filePath;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { force: true, recursive: true });
  }
});

describe("analyzePropsDescriptor", () => {
  test("analyzes function component props with constraints and rich shapes", () => {
    const filePath = writeTempFile(
      "Button.tsx",
      `type ReactNode = string | number | null;
type ButtonProps = {
  /** @fuzz.minLength 1 @fuzz.maxLength 4 */
  label: string;
  count?: 0 | 1 | undefined;
  createdAt: Date;
  items: string[];
  tuple: [string, number];
  children?: ReactNode;
  onClick?: () => void;
};
export const Button = (_props: ButtonProps) => null;`,
    );

    const descriptor = analyzePropsDescriptor({
      exportName: "Button",
      sourcePath: filePath,
    });
    expect(descriptor.kind).toBe("object");
    const properties = Object.fromEntries(
      descriptor.kind === "object" ? descriptor.properties.map((property) => [property.key, property]) : [],
    );
    expect(properties.label).toMatchObject({ optional: false, value: { kind: "string", constraints: { minLength: 1, maxLength: 4 } } });
    expect(properties.count).toMatchObject({ optional: true, value: { kind: "union" } });
    expect(properties.createdAt).toMatchObject({ optional: false, value: { kind: "object" } });
    expect(properties.items).toMatchObject({ optional: false, value: { kind: "array" } });
    expect(properties.tuple).toMatchObject({ optional: false, value: { kind: "tuple" } });
    expect(properties.children).toMatchObject({ optional: true, value: { kind: "react-node" } });
    expect(properties.onClick).toMatchObject({ optional: true, value: { kind: "function" } });
  });

  test("supports explicit props types, direct $props, and constructor props", () => {
    const explicitPath = writeTempFile(
      "Explicit.ts",
      `export type ExplicitProps = { label: string; enabled?: boolean };`,
    );
    expect(
      analyzePropsDescriptor({
        typeName: "ExplicitProps",
        sourcePath: explicitPath,
      }),
    ).toMatchObject({ kind: "object" });

    const directPropsPath = writeTempFile(
      "Direct.ts",
      `export const Widget: { $props: { label: string; count?: number } } = {} as never;`,
    );
    const directDescriptor = analyzePropsDescriptor({
      exportName: "Widget",
      sourcePath: directPropsPath,
    });
    expect(directDescriptor.kind).toBe("object");
    const directProperties = Object.fromEntries(
      directDescriptor.kind === "object" ? directDescriptor.properties.map((property) => [property.key, property]) : [],
    );
    expect(directProperties.label?.optional).toBe(false);
    expect(directProperties.count?.optional).toBe(true);

    const ctorPath = writeTempFile(
      "Ctor.ts",
      `export class Widget {
  constructor(_options: { props: { label: string; enabled?: boolean } }) {}
}`,
    );
    const ctorDescriptor = analyzePropsDescriptor({
      exportName: "Widget",
      sourcePath: ctorPath,
    });
    expect(ctorDescriptor.kind).toBe("object");
    const ctorProperties = Object.fromEntries(
      ctorDescriptor.kind === "object" ? ctorDescriptor.properties.map((property) => [property.key, property]) : [],
    );
    expect(ctorProperties.label?.optional).toBe(false);
    expect(ctorProperties.enabled?.optional).toBe(true);
  });

  test("supports generic typeName lookups for non-component TypeScript types", () => {
    const explicitPath = writeTempFile(
      "Query.ts",
      `export interface Query {
  /** @fuzz.minLength 1 */
  term: string;
  page?: number;
}`,
    );

    const descriptor = analyzeTypeDescriptor({
      sourcePath: explicitPath,
      typeName: "Query",
    });

    expect(descriptor.kind).toBe("object");
    const properties = Object.fromEntries(
      descriptor.kind === "object" ? descriptor.properties.map((property) => [property.key, property]) : [],
    );
    expect(properties.term).toMatchObject({
      optional: false,
      value: { kind: "string", constraints: { minLength: 1 } },
    });
    expect(properties.page).toMatchObject({
      optional: true,
      value: { kind: "number" },
    });
  });

  test("supports resolved and distributive conditional types", () => {
    const fixturePath = fileURLToPath(new URL("./fixtures/ConditionalTypes.ts", import.meta.url));

    expect(
      analyzeTypeDescriptor({
        sourcePath: fixturePath,
        typeName: "ConcreteConditional",
      }),
    ).toMatchObject({
      kind: "object",
      properties: expect.arrayContaining([
        { key: "kind", optional: false, value: { kind: "literal", value: "string" } },
        { key: "value", optional: false, value: { kind: "literal", value: "x" } },
      ]),
    });

    const distributed = analyzeTypeDescriptor({
      sourcePath: fixturePath,
      typeName: "DistributedConditional",
    });
    expect(distributed).toMatchObject({
      kind: "union",
      options: expect.arrayContaining([
        {
          kind: "object",
          properties: expect.arrayContaining([
            { key: "kind", optional: false, value: { kind: "literal", value: "string" } },
          ]),
        },
        {
          kind: "object",
          properties: expect.arrayContaining([
            { key: "kind", optional: false, value: { kind: "literal", value: "number" } },
          ]),
        },
      ]),
    });
  });

  test("generalizes simple unresolved conditional types from their extends constraints", () => {
    const descriptor = analyzeTypeDescriptor({
      sourcePath: fileURLToPath(new URL("./fixtures/ConditionalTypes.ts", import.meta.url)),
      typeName: "WrappedGeneric",
    });

    expect(descriptor.kind).toBe("union");
    const branches =
      descriptor.kind === "union"
        ? descriptor.options.filter((option): option is Extract<typeof option, { kind: "object" }> => option.kind === "object")
        : [];
    const valueBranch = branches.find((branch) => branch.properties.some((property) => property.key === "value"));
    const itemsBranch = branches.find((branch) => branch.properties.some((property) => property.key === "items"));
    const valueProperty = valueBranch?.properties.find((property) => property.key === "value");
    const itemsProperty = itemsBranch?.properties.find((property) => property.key === "items");

    expect(valueProperty).toMatchObject({
      key: "value",
      optional: false,
      value: { kind: "string" },
    });
    expect(itemsProperty).toMatchObject({
      key: "items",
      optional: false,
      value: { kind: "array", item: { kind: "number", integer: false } },
    });
  });

  test("uses extends constraints to generalize unresolved generic parameters", () => {
    const filePath = writeTempFile(
      "Generic.ts",
      `export type Box<T extends string> = {
  value: T;
  items: T[];
};`,
    );

    const descriptor = analyzeTypeDescriptor({
      sourcePath: filePath,
      typeName: "Box",
    });

    expect(descriptor.kind).toBe("object");
    const properties = Object.fromEntries(
      descriptor.kind === "object" ? descriptor.properties.map((property) => [property.key, property]) : [],
    );
    expect(properties.value).toMatchObject({
      optional: false,
      value: { kind: "string" },
    });
    expect(properties.items).toMatchObject({
      optional: false,
      value: { kind: "array", item: { kind: "string" } },
    });
  });

  test("reports warnings for generics that cannot be generalized", () => {
    const filePath = writeTempFile(
      "UnboundGeneric.ts",
      `export type Box<T> = {
  value: T;
};`,
    );

    const resolved = resolveFuzzData({
      sourcePath: filePath,
      typeName: "Box",
    });

    expect(resolved.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('generic type parameter "T" is unconstrained'),
      ]),
    );
    expect(resolved.valueDescriptor).toMatchObject({
      kind: "object",
      properties: expect.arrayContaining([
        {
          key: "value",
          optional: false,
          value: { kind: "unknown" },
        },
      ]),
    });
  });

  test("warns and falls back for unresolved conditional types that use infer", () => {
    const resolved = resolveFuzzData({
      sourcePath: fileURLToPath(new URL("./fixtures/ConditionalTypes.ts", import.meta.url)),
      typeName: "InferGeneric",
    });

    expect(resolved.valueDescriptor).toMatchObject({ kind: "unknown" });
    expect(resolved.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('conditional type "InferGeneric" uses infer'),
      ]),
    );
  });

  test("normalizes common external runtime types", () => {
    const descriptor = analyzeTypeDescriptor({
      sourcePath: fileURLToPath(new URL("./fixtures/ExternalTypes.ts", import.meta.url)),
      typeName: "ExternalTypes",
    });

    expect(descriptor.kind).toBe("object");
    const properties = Object.fromEntries(
      descriptor.kind === "object" ? descriptor.properties.map((property) => [property.key, property]) : [],
    );
    expect(properties.children).toMatchObject({
      optional: true,
      value: { kind: "react-node" },
    });
    expect(properties.endpoint).toMatchObject({
      optional: false,
      value: { kind: "url" },
    });
    expect(properties.lookup).toMatchObject({
      optional: false,
      value: { kind: "map", key: { kind: "string" }, value: { kind: "number" } },
    });
    expect(properties.tags).toMatchObject({
      optional: false,
      value: { kind: "set", item: { kind: "string" } },
    });
  });

  test("applies ts-fuzzing marker types without erasing the base TypeScript shape", () => {
    const descriptor = analyzeTypeDescriptor({
      sourcePath: fileURLToPath(new URL("./fixtures/FuzzHints.ts", import.meta.url)),
      typeName: "FuzzHints",
    });

    expect(descriptor.kind).toBe("object");
    const properties = Object.fromEntries(
      descriptor.kind === "object" ? descriptor.properties.map((property) => [property.key, property]) : [],
    );
    expect(properties.id).toMatchObject({
      optional: false,
      value: { kind: "string", constraints: { pattern: "uuid" } },
    });
    expect(properties.token).toMatchObject({
      optional: false,
      value: { kind: "string", constraints: { pattern: "ulid" } },
    });
    expect(properties.createdAt).toMatchObject({
      optional: false,
      value: { kind: "string", constraints: { pattern: "iso-date" } },
    });
    expect(properties.email).toMatchObject({
      optional: false,
      value: { kind: "string", constraints: { pattern: "email" } },
    });
    expect(properties.score).toMatchObject({
      optional: false,
      value: { kind: "number", integer: true, constraints: { min: 0, max: 10 } },
    });
    expect(properties.ratio).toMatchObject({
      optional: false,
      value: { kind: "number", integer: false, constraints: { min: 0, max: 1 } },
    });
    expect(properties.title).toMatchObject({
      optional: false,
      value: { kind: "string", constraints: { minLength: 2, maxLength: 4 } },
    });
    expect(properties.tags).toMatchObject({
      optional: false,
      value: { kind: "array", item: { kind: "string" }, constraints: { minItems: 1, maxItems: 2 } },
    });
  });

  test("warns when a ts-fuzzing marker is used without an explicit base type", () => {
    const resolved = resolveFuzzData({
      sourcePath: fileURLToPath(new URL("./fixtures/FuzzHints.ts", import.meta.url)),
      typeName: "BareHint",
    });

    expect(resolved.valueDescriptor).toMatchObject({
      kind: "string",
      constraints: { pattern: "uuid" },
    });
    expect(resolved.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("should be intersected with an explicit base type"),
      ]),
    );
  });

  test("handles intersections and recursive types conservatively", () => {
    const filePath = writeTempFile(
      "Complex.tsx",
      `type Base = { id: string };
type Extra = { enabled?: boolean };
type Node = { next?: Node };
export type Props = Base & Extra & { tree?: Node };
export const Complex = (_props: Props) => null;`,
    );

    const descriptor = analyzePropsDescriptor({
      exportName: "Complex",
      sourcePath: filePath,
    });
    expect(descriptor.kind).toBe("object");
    const properties = Object.fromEntries(
      descriptor.kind === "object" ? descriptor.properties.map((property) => [property.key, property]) : [],
    );
    expect(properties.id).toMatchObject({ optional: false, value: { kind: "string" } });
    expect(properties.enabled).toMatchObject({ optional: true, value: { kind: "union" } });
    expect(properties.tree?.optional).toBe(true);
    expect(properties.tree?.value).toMatchObject({
      kind: "object",
      properties: expect.arrayContaining([{ key: "next", optional: true, value: { kind: "unknown" } }]),
    });
  });

  test("supports alias exports and ignores unknown fuzz tags", () => {
    const filePath = writeTempFile(
      "Aliased.tsx",
      `type Props = {
  /** @fuzz.unknown 1 */
  label: string;
};
const Inner = (_props: Props) => null;
export { Inner as AliasedButton };`,
    );

    const descriptor = analyzePropsDescriptor({
      exportName: "AliasedButton",
      sourcePath: filePath,
    });
    expect(descriptor.kind).toBe("object");
    const properties = Object.fromEntries(
      descriptor.kind === "object" ? descriptor.properties.map((property) => [property.key, property]) : [],
    );
    expect(properties.label).toMatchObject({
      optional: false,
      value: { kind: "string", constraints: undefined },
    });
  });

  test("merges duplicate intersection keys and preserves optionality", () => {
    const filePath = writeTempFile(
      "MergedIntersection.tsx",
      `type Left = { shared?: string };
type Right = { shared?: string };
type Props = Left & Right;
export const Merged = (_props: Props) => null;`,
    );

    const descriptor = analyzePropsDescriptor({
      exportName: "Merged",
      sourcePath: filePath,
    });
    expect(descriptor.kind).toBe("object");
    const properties = Object.fromEntries(
      descriptor.kind === "object" ? descriptor.properties.map((property) => [property.key, property]) : [],
    );
    expect(properties.shared).toMatchObject({
      optional: true,
      value: { kind: "string" },
    });
  });

  test("covers false literals, explicit undefined props, and non-object intersections", () => {
    const filePath = writeTempFile(
      "Primitives.tsx",
      `type Props = {
  disabled: false;
  missing: undefined;
  weird: { value: string } & string;
};
export const PrimitiveProps = (_props: Props) => null;`,
    );

    const descriptor = analyzePropsDescriptor({
      exportName: "PrimitiveProps",
      sourcePath: filePath,
    });
    expect(descriptor.kind).toBe("object");
    const properties = Object.fromEntries(
      descriptor.kind === "object" ? descriptor.properties.map((property) => [property.key, property]) : [],
    );
    expect(properties.disabled).toMatchObject({
      optional: false,
      value: { kind: "literal", value: false },
    });
    expect(properties.missing).toMatchObject({
      optional: false,
      value: { kind: "undefined" },
    });
    expect(properties.weird).toMatchObject({
      optional: false,
      value: { kind: "unknown" },
    });
  });

  test("returns an unknown descriptor for call signatures without props", () => {
    const filePath = writeTempFile(
      "NoProps.tsx",
      `export const NoProps: () => null = () => null;`,
    );

    expect(
      analyzePropsDescriptor({
        exportName: "NoProps",
        sourcePath: filePath,
      }),
    ).toMatchObject({ kind: "unknown" });
  });

  test("analyzes repo fixtures that are already included in tsconfig", () => {
    const descriptor = analyzePropsDescriptor({
      exportName: "SafeButton",
      sourcePath: fileURLToPath(new URL("./fixtures/SafeButton.tsx", import.meta.url)),
    });
    expect(descriptor.kind).toBe("object");
  });

  test("throws clear errors for invalid lookups", () => {
    const filePath = writeTempFile(
      "Broken.tsx",
      `export const Button = () => null;`,
    );

    expect(() =>
      analyzePropsDescriptor({
        exportName: "Missing",
        sourcePath: filePath,
      }),
    ).toThrow("export not found");

    expect(() =>
      analyzePropsDescriptor({
        sourcePath: filePath,
      } as never),
    ).toThrow("exportName or typeName is required");
  });

  test("throws formatted TypeScript diagnostics for invalid sources", () => {
    const filePath = writeTempFile(
      "Invalid.tsx",
      `export const Broken = (_props: { label: string }) => <div>{</div>;`,
    );

    expect(() =>
      analyzePropsDescriptor({
        exportName: "Broken",
        sourcePath: filePath,
      }),
    ).toThrow(/TS\d+|Declaration or statement expected|Expression expected/);
  });
});
