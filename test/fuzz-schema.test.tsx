import type { StandardSchemaV1 } from "@standard-schema/spec";
import * as v from "valibot";
import * as z from "zod";
import { describe, expect, test } from "vitest";
import {
  fuzzReactComponent,
  quickCheckReactComponent,
} from "../src/react.js";
import {
  sampleBoundaryProps,
  sampleProps,
} from "../src/index.js";
import { BoundaryWidget } from "./fixtures/BoundaryWidget.js";
import { ExplosiveCard } from "./fixtures/ExplosiveCard.js";
import { SafeButton } from "./fixtures/SafeButton.js";
import type { SafeButtonProps } from "./fixtures/SafeButton.js";

const explosiveCardSchema = z.object({
  title: z.string().min(1).max(16),
  variant: z.enum(["safe", "danger"]),
  items: z.array(z.string().min(1).max(8)).min(1).max(3),
});

const boundaryWidgetSchema = v.object({
  label: v.pipe(v.string(), v.minLength(1), v.maxLength(4)),
  count: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(2)),
  variant: v.picklist(["safe", "danger"]),
});

const primaryOnlySchema: StandardSchemaV1<SafeButtonProps> = {
  "~standard": {
    types: undefined,
    validate(value) {
      if (typeof value !== "object" || value === null) {
        return {
          issues: [{ message: "expected object" }],
        };
      }

      const candidate = value as Record<string, unknown>;
      const issues: StandardSchemaV1.Issue[] = [];
      if (typeof candidate.label !== "string" || candidate.label.length < 1) {
        issues.push({ message: "label is required", path: ["label"] });
      }
      if (candidate.variant !== "primary") {
        issues.push({ message: "variant must be primary", path: ["variant"] });
      }
      if (candidate.count !== undefined && (typeof candidate.count !== "number" || candidate.count > 1)) {
        issues.push({ message: "count must be <= 1", path: ["count"] });
      }

      if (issues.length > 0) {
        return { issues };
      }

      return {
        value: candidate as SafeButtonProps,
      };
    },
    vendor: "custom",
    version: 1,
  },
};

const impossibleSafeButtonSchema: StandardSchemaV1<SafeButtonProps> = {
  "~standard": {
    types: undefined,
    validate(value) {
      if (typeof value !== "object" || value === null) {
        return {
          issues: [{ message: "expected object" }],
        };
      }

      const candidate = value as Record<string, unknown>;
      if (candidate.variant !== "secondary") {
        return {
          issues: [{ message: "variant must be secondary", path: ["variant"] }],
        };
      }

      return {
        value: candidate as SafeButtonProps,
      };
    },
    vendor: "custom",
    version: 1,
  },
};

const transformingSafeButtonSchema: StandardSchemaV1<SafeButtonProps, SafeButtonProps> = {
  "~standard": {
    types: undefined,
    validate(value) {
      if (typeof value !== "object" || value === null) {
        return {
          issues: [{ message: "expected object" }],
        };
      }

      const candidate = value as Partial<SafeButtonProps>;
      if (typeof candidate.label !== "string" || candidate.label.length < 1) {
        return {
          issues: [{ message: "label is required", path: ["label"] }],
        };
      }
      if (candidate.variant !== "primary" && candidate.variant !== "ghost") {
        return {
          issues: [{ message: "variant is invalid", path: ["variant"] }],
        };
      }

      return {
        value: {
          ...candidate,
          label: candidate.label.trim().toUpperCase(),
          variant: "primary",
        } as SafeButtonProps,
      };
    },
    vendor: "custom",
    version: 1,
  },
};

const transformedDirectSchema = z.object({
  label: z.string().transform((value) => value.toUpperCase()),
  count: z.coerce.number().int().min(0).max(2),
});

describe("schema support", () => {
  test("samples props directly from a zod schema", async () => {
    const values: Array<Record<string, any>> = [];
    for await (const value of sampleProps({
      schema: explosiveCardSchema,
      numRuns: 8,
      seed: 10,
    })) {
      values.push(value);
    }

    expect(values).toHaveLength(8);
    for (const value of values) {
      expect(() => explosiveCardSchema.parse(value)).not.toThrow();
    }
  });

  test("samples boundary props directly from a valibot schema", async () => {
    const values: Array<Record<string, any>> = [];
    for await (const value of sampleBoundaryProps({
      schema: boundaryWidgetSchema,
      maxCases: 32,
    })) {
      values.push(value);
    }

    expect(values.some((value) => value.count === 0)).toBe(true);
    expect(values.some((value) => value.count === 2)).toBe(true);
    expect(values.some((value) => value.label.length === 1)).toBe(true);
    expect(values.some((value) => value.label.length === 4)).toBe(true);
  });

  test("fuzzes a react component directly from a zod schema", async () => {
    await expect(
      fuzzReactComponent({
        component: ExplosiveCard,
        schema: explosiveCardSchema,
        numRuns: 48,
        seed: 2,
      }),
    ).rejects.toMatchObject({
      name: "ReactComponentFuzzError",
      failingValue: {
        variant: "danger",
      },
    });
  });

  test("filters library-type generation through a standard schema validator", async () => {
    const values: Array<Record<string, any>> = [];
    for await (const value of sampleProps({
      sourcePath: new URL("./fixtures/SafeButton.tsx", import.meta.url),
      exportName: "SafeButton",
      schema: primaryOnlySchema,
      numRuns: 6,
      seed: 11,
    })) {
      values.push(value);
    }

    expect(values).toHaveLength(6);
    for (const value of values) {
      expect(value.variant).toBe("primary");
      if ("count" in value) {
        expect(value.count).toBeLessThanOrEqual(1);
      }
    }
  });

  test("returns normalized schema output from direct zod sampling", async () => {
    const values: Array<Record<string, any>> = [];
    for await (const value of sampleProps({
      schema: transformedDirectSchema,
      numRuns: 8,
      seed: 4,
    })) {
      values.push(value);
    }

    expect(values).toHaveLength(8);
    for (const value of values) {
      expect(value.label).toBe(value.label.toUpperCase());
      expect(typeof value.count).toBe("number");
      expect(Number.isInteger(value.count)).toBe(true);
    }
  });

  test("returns normalized schema output when sourcePath is combined with a standard schema", async () => {
    const values: Array<Record<string, any>> = [];
    for await (const value of sampleProps({
      sourcePath: new URL("./fixtures/SafeButton.tsx", import.meta.url),
      exportName: "SafeButton",
      schema: transformingSafeButtonSchema,
      numRuns: 8,
      seed: 12,
    })) {
      values.push(value);
    }

    expect(values).toHaveLength(8);
    for (const value of values) {
      expect(value.label).toBe(value.label.toUpperCase());
      expect(value.variant).toBe("primary");
    }
  });

  test("returns normalized boundary cases when sourcePath is combined with a standard schema", async () => {
    const values: Array<Record<string, any>> = [];
    for await (const value of sampleBoundaryProps({
      sourcePath: new URL("./fixtures/SafeButton.tsx", import.meta.url),
      exportName: "SafeButton",
      schema: transformingSafeButtonSchema,
      maxCases: 32,
    })) {
      values.push(value);
    }

    expect(values.length).toBeGreaterThan(0);
    for (const value of values) {
      expect(value.label).toBe(value.label.toUpperCase());
      expect(value.variant).toBe("primary");
    }
  });

  test("passes normalized schema output to react fuzz rendering", async () => {
    await expect(
      fuzzReactComponent({
        component: SafeButton,
        sourcePath: new URL("./fixtures/SafeButton.tsx", import.meta.url),
        exportName: "SafeButton",
        schema: transformingSafeButtonSchema,
        numRuns: 24,
        seed: 3,
        render: (props) => {
          expect(props.label).toBe(props.label.toUpperCase());
          expect(props.variant).toBe("primary");
        },
      }),
    ).resolves.toBeUndefined();
  });

  test("fails boundary sampling when schema filtering removes every case", async () => {
    await expect(
      (async () => {
        for await (const _ of sampleBoundaryProps({
          sourcePath: new URL("./fixtures/SafeButton.tsx", import.meta.url),
          exportName: "SafeButton",
          schema: impossibleSafeButtonSchema,
          maxCases: 32,
        })) {
          // exhaust iterator
        }
      })(),
    ).rejects.toThrow("schema filtering removed every boundary case");
  });

  test("fails react quick-check when schema filtering removes every case", async () => {
    await expect(
      quickCheckReactComponent({
        component: SafeButton,
        sourcePath: new URL("./fixtures/SafeButton.tsx", import.meta.url),
        exportName: "SafeButton",
        schema: impossibleSafeButtonSchema,
        maxCases: 32,
      }),
    ).rejects.toThrow("schema filtering removed every boundary case");
  });
});
