import { fileURLToPath } from "node:url";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import * as z from "zod";
import { describe, expect, test } from "vitest";
import type { TypeDescriptor } from "../src/descriptor.js";
import {
  fuzzComponent,
  fuzzComponentGuided,
  quickCheckComponent,
  sampleBoundaryProps,
  sampleBoundaryPropsFromSchema,
  sampleProps,
  samplePropsFromSchema,
} from "../src/index.js";
import { collectAsync } from "./helpers/collect_async.js";

const safeButtonPath = fileURLToPath(new URL("./fixtures/SafeButton.tsx", import.meta.url));
const boundaryWidgetPath = fileURLToPath(new URL("./fixtures/BoundaryWidget.tsx", import.meta.url));

const primaryOnlySchema: StandardSchemaV1<Record<string, unknown>> = {
  "~standard": {
    types: undefined,
    validate(value) {
      if (
        typeof value !== "object" ||
        value === null ||
        typeof (value as { label?: unknown }).label !== "string" ||
        (value as { variant?: unknown }).variant !== "primary"
      ) {
        return {
          issues: [{ message: "variant must be primary" }],
        };
      }
      return {
        value: value as Record<string, unknown>,
      };
    },
    vendor: "custom",
    version: 1,
  },
};

const impossibleSchema: StandardSchemaV1<Record<string, unknown>> = {
  "~standard": {
    types: undefined,
    validate(value) {
      if (
        typeof value !== "object" ||
        value === null ||
        typeof (value as { label?: unknown }).label !== "string" ||
        (value as { variant?: unknown }).variant !== "secondary"
      ) {
        return {
          issues: [{ message: "variant must be secondary" }],
        };
      }
      return {
        value: value as Record<string, unknown>,
      };
    },
    vendor: "custom",
    version: 1,
  },
};

const directOnlySchema: StandardSchemaV1<Record<string, unknown>> = {
  "~standard": {
    types: undefined,
    validate(value) {
      if (typeof value !== "object" || value === null) {
        return {
          issues: [{ message: "expected object" }],
        };
      }
      return {
        value: value as Record<string, unknown>,
      };
    },
    vendor: "custom",
    version: 1,
  },
};

const alternatingSchema = () => {
  let calls = 0;
  return {
    "~standard": {
      types: undefined,
      validate(value: unknown) {
        calls += 1;
        if (calls % 2 === 0) {
          return {
            issues: [{ message: "skip alternating candidate" }],
          };
        }
        return {
          value: value as Record<string, unknown>,
        };
      },
      vendor: "custom",
      version: 1,
    },
  } satisfies StandardSchemaV1<Record<string, unknown>>;
};

describe("fuzz core branches", () => {
  test("samples props from a string sourcePath with the default numRuns", async () => {
    const values = await collectAsync(sampleProps({
      sourcePath: safeButtonPath,
      exportName: "SafeButton",
    }));

    expect(values).toHaveLength(10);
    expect(values.every((value) => typeof value.label === "string")).toBe(true);
  });

  test("uses render.describeInput when sampling boundary props", async () => {
    const descriptor: TypeDescriptor = {
      kind: "object",
      properties: [
        {
          key: "marker",
          optional: false,
          value: {
            kind: "literal",
            value: "from-render",
          },
        },
      ],
    };

    const values = await collectAsync(sampleBoundaryProps({
      sourcePath: safeButtonPath,
      exportName: "SafeButton",
      render: {
        describeInput: () => descriptor,
        render: () => undefined,
      },
    }));

    expect(values).toEqual([{ marker: "from-render" }]);
  });

  test("rejects schema-only vendors that cannot describe props directly", async () => {
    await expect(
      collectAsync(sampleProps({
        schema: directOnlySchema,
      })),
    ).rejects.toThrow(
      'schema vendor "custom" cannot generate values directly. pass sourcePath to use TypeScript types as the base shape',
    );
  });

  test("fails when neither sourcePath nor schema is provided", async () => {
    await expect(collectAsync(sampleProps({} as never))).rejects.toThrow("sourcePath or schema is required");
  });

  test("samples props through the schema-only wrapper helpers", async () => {
    const values = await collectAsync(samplePropsFromSchema({
      schema: z.object({
        label: z.string().min(1),
      }),
      numRuns: 4,
      seed: 2,
    }));

    expect(values).toHaveLength(4);
    expect(values.every((value) => typeof value.label === "string")).toBe(true);
  });

  test("samples boundary values through the schema-only wrapper helpers", async () => {
    const values = await collectAsync(sampleBoundaryPropsFromSchema({
      schema: z.object({
        label: z.string().min(1).max(2),
      }),
      maxCases: 8,
    }));

    expect(values.length).toBeGreaterThan(0);
    expect(values.some((value) => value.label.length === 1)).toBe(true);
  });

  test("fails when schema filtering cannot produce enough valid samples", async () => {
    await expect(
      collectAsync(sampleProps({
        sourcePath: safeButtonPath,
        exportName: "SafeButton",
        numRuns: 1,
        schema: impossibleSchema,
      })),
    ).rejects.toThrow("failed to generate enough valid values from descriptor and schema");
  });

  test("skips candidates that become invalid during fuzz execution", async () => {
    let renders = 0;
    await expect(
      fuzzComponent({
        component: {},
        sourcePath: safeButtonPath,
        exportName: "SafeButton",
        numRuns: 4,
        render: () => {
          renders += 1;
        },
        schema: alternatingSchema(),
        seed: 1,
      }),
    ).resolves.toBeUndefined();

    expect(renders).toBeLessThanOrEqual(4);
  });

  test("guided fuzzing supports schema-only runs without a coverage target", async () => {
    const report = await fuzzComponentGuided({
      component: {},
      schema: z.object({
        label: z.string().min(1),
      }),
      initialCorpusSize: 2,
      maxIterations: 4,
      render: () => undefined,
      seed: 1,
    });

    expect(report.discoveredBlocks).toBe(0);
    expect(report.discoveries).toEqual([]);
    expect(report.iterations).toBe(4);
  });

  test("guided fuzzing skips schema-invalid candidates from describeInput", async () => {
    const report = await fuzzComponentGuided({
      component: {},
      sourcePath: safeButtonPath,
      exportName: "SafeButton",
      initialCorpusSize: 1,
      maxIterations: 2,
      render: {
        describeInput: () => ({
          kind: "object",
          properties: [
            {
              key: "label",
              optional: false,
              value: { kind: "literal", value: "ok" },
            },
            {
              key: "variant",
              optional: false,
              value: { kind: "literal", value: "ghost" },
            },
          ],
        }),
        render: () => undefined,
      },
      schema: primaryOnlySchema,
      seed: 1,
    });

    expect(report.iterations).toBe(0);
    expect(report.corpusSize).toBe(0);
    expect(report.discoveries).toEqual([]);
  });

  test("uses the default maxCases in quickCheckComponent", async () => {
    const report = await quickCheckComponent({
      component: {},
      sourcePath: safeButtonPath,
      exportName: "SafeButton",
      render: () => undefined,
    });

    expect(report.checkedCases).toBeGreaterThan(0);
    expect(report.totalCases).toBe(report.checkedCases);
  });

  test("reports failures from the core quick-check API", async () => {
    await expect(
      quickCheckComponent({
        component: {},
        sourcePath: boundaryWidgetPath,
        exportName: "BoundaryWidget",
        render: (props) => {
          const candidate = props as { count: number; label: string; variant: string };
          if (candidate.count === 2 && candidate.label.length === 4 && candidate.variant === "danger") {
            throw new Error("boundary exploded");
          }
        },
      }),
    ).rejects.toMatchObject({
      name: "ComponentFuzzError",
      failingValue: {
        count: 2,
        variant: "danger",
      },
    });
  });
});
