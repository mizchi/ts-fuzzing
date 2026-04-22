import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import * as z from "zod";
import {
  fuzzComponent,
  fuzzComponentGuided,
  quickCheckComponent,
  sampleBoundaryProps,
  sampleProps,
  sampleValuesFromSchema,
  type ComponentRenderStrategy,
} from "ts-fuzzing";
import Badge from "../src/Badge.vue";
import ExplosiveButton from "../src/ExplosiveButton.vue";
import PriceTag from "../src/PriceTag.vue";

const badgePath = new URL("../src/Badge.vue", import.meta.url);
const explosivePath = new URL("../src/ExplosiveButton.vue", import.meta.url);
const priceTagPath = new URL("../src/PriceTag.vue", import.meta.url);
const priceTagPropsPath = new URL("../src/PriceTag.props.ts", import.meta.url);

const createVueSsrRender = <Component, Props = Record<string, unknown>>(): ComponentRenderStrategy<Component, Props> => ({
  async render(component, props) {
    const { createSSRApp } = await import("vue");
    const { renderToString } = await import("vue/server-renderer");
    const app = createSSRApp(component as object, props as Record<string, unknown>);
    await renderToString(app);
  },
});

const receiptSchema = z.object({
  currency: z.enum(["JPY", "USD"]),
  amount: z.number().int().min(0).max(9999),
});

const tempDirs: string[] = [];

const makeTempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-fuzzing-vue-example-"));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { force: true, recursive: true });
  }
});

describe("vue-first example project", () => {
  test("sampleProps iterates props parsed straight from the SFC", async () => {
    const values: Array<Record<string, unknown>> = [];
    for await (const value of sampleProps({
      sourcePath: badgePath,
      numRuns: 6,
      seed: 3,
    })) {
      values.push(value);
    }

    expect(values).toHaveLength(6);
    for (const value of values) {
      expect(typeof value.label).toBe("string");
      if ("tone" in value && value.tone !== undefined) {
        expect(["info", "warn"]).toContain(value.tone);
      }
    }
  });

  test("fuzzComponent renders the SFC through vue/server-renderer", async () => {
    await expect(
      fuzzComponent({
        component: Badge,
        sourcePath: badgePath,
        render: createVueSsrRender(),
        numRuns: 24,
        seed: 7,
      }),
    ).resolves.toBeUndefined();
  });

  test("setup-time throws are reported as ComponentFuzzError", async () => {
    await expect(
      fuzzComponent({
        component: ExplosiveButton,
        sourcePath: explosivePath,
        render: createVueSsrRender(),
        numRuns: 32,
        seed: 11,
      }),
    ).rejects.toMatchObject({
      name: "ComponentFuzzError",
      failingValue: {
        mode: "explode",
      },
    });
  });

  test("quickCheckComponent uses a companion .props.ts file", async () => {
    const report = await quickCheckComponent({
      component: PriceTag,
      sourcePath: priceTagPropsPath,
      typeName: "PriceTagProps",
      render: createVueSsrRender(),
      maxCases: 32,
    });

    expect(report.checkedCases).toBeGreaterThan(0);
    expect(report.totalCases).toBeGreaterThan(0);
  });

  test("schema-driven fuzzing feeds normalized props straight into the SFC", async () => {
    const values: Array<z.infer<typeof receiptSchema>> = [];
    for await (const value of sampleValuesFromSchema({
      schema: receiptSchema,
      numRuns: 4,
      seed: 5,
    })) {
      values.push(value);
    }

    expect(values).toHaveLength(4);
    for (const value of values) {
      expect(["JPY", "USD"]).toContain(value.currency);
    }

    await expect(
      fuzzComponent({
        component: PriceTag,
        schema: receiptSchema,
        render: createVueSsrRender(),
        numRuns: 16,
        seed: 5,
      }),
    ).resolves.toBeUndefined();
  });

  test("render strategies can run their own lightweight checks", async () => {
    await expect(
      fuzzComponent({
        component: PriceTag,
        sourcePath: priceTagPath,
        numRuns: 16,
        seed: 1,
        render: async (props) => {
          const candidate = props as { amount: number; currency: string };
          if (candidate.amount < 0) {
            throw new Error(`negative amount: ${candidate.amount}`);
          }
        },
      }),
    ).resolves.toBeUndefined();
  });

  test("sampleBoundaryProps surfaces the edge cases of a .props.ts file", async () => {
    const values: Array<Record<string, unknown>> = [];
    for await (const value of sampleBoundaryProps({
      sourcePath: priceTagPropsPath,
      typeName: "PriceTagProps",
      maxCases: 32,
    })) {
      values.push(value);
    }

    const amounts = values.map((value) => value.amount);
    expect(amounts).toContain(0);
    expect(amounts).toContain(9999);
  });

  test("guided mode persists a corpus while running", async () => {
    const corpusDir = makeTempDir();
    const corpusPath = path.join(corpusDir, "price-tag-corpus.json");

    const report = await fuzzComponentGuided({
      component: PriceTag,
      sourcePath: priceTagPropsPath,
      typeName: "PriceTagProps",
      render: createVueSsrRender(),
      corpusPath,
      initialCorpusSize: 4,
      maxIterations: 8,
      seed: 13,
    });

    expect(report.iterations).toBe(8);
    expect(fs.existsSync(corpusPath)).toBe(true);
    expect(report.corpusSize).toBeGreaterThan(0);
  });
});
