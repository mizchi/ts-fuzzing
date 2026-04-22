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
} from "ts-fuzzing";
import { createSvelteRender } from "ts-fuzzing/svelte";
import Badge from "../src/Badge.svelte";
import ExplosiveButton from "../src/ExplosiveButton.svelte";
import PriceTag from "../src/PriceTag.svelte";
import RunesTag from "../src/RunesTag.svelte";

const badgePath = new URL("../src/Badge.svelte", import.meta.url);
const explosivePropsPath = new URL("../src/ExplosiveButton.props.ts", import.meta.url);
const runesPath = new URL("../src/RunesTag.svelte", import.meta.url);
const priceTagPropsPath = new URL("../src/PriceTag.props.ts", import.meta.url);

const receiptSchema = z.object({
  currency: z.enum(["JPY", "USD"]),
  amount: z.number().int().min(0).max(9999),
});

const tempDirs: string[] = [];

const makeTempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-fuzzing-svelte-example-"));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { force: true, recursive: true });
  }
});

describe("svelte-first example project", () => {
  test("sampleProps reads classic export let declarations", async () => {
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
      expect((value.label as string).length).toBeGreaterThanOrEqual(1);
      if ("tone" in value && value.tone !== undefined) {
        expect(["info", "warn"]).toContain(value.tone);
      }
    }
  });

  test("sampleProps understands Svelte 5 runes props", async () => {
    const values: Array<Record<string, unknown>> = [];
    for await (const value of sampleProps({
      sourcePath: runesPath,
      numRuns: 6,
      seed: 9,
    })) {
      values.push(value);
    }

    expect(values).toHaveLength(6);
    for (const value of values) {
      expect(typeof value.label).toBe("string");
      if ("count" in value && typeof value.count === "number") {
        expect(value.count).toBeGreaterThanOrEqual(0);
        expect(value.count).toBeLessThanOrEqual(9);
      }
    }
  });

  test("fuzzComponent renders through svelte/server", async () => {
    await expect(
      fuzzComponent({
        component: Badge,
        sourcePath: badgePath,
        render: createSvelteRender(),
        numRuns: 24,
        seed: 7,
      }),
    ).resolves.toBeUndefined();
  });

  test("script-time throws surface as ComponentFuzzError", async () => {
    await expect(
      fuzzComponent({
        component: ExplosiveButton,
        sourcePath: explosivePropsPath,
        typeName: "ExplosiveButtonProps",
        render: createSvelteRender(),
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
      render: createSvelteRender(),
      maxCases: 32,
    });

    expect(report.checkedCases).toBeGreaterThan(0);
    expect(report.totalCases).toBeGreaterThan(0);
  });

  test("context factories receive the generated props", async () => {
    const render = createSvelteRender<typeof Badge, Record<string, unknown>>({
      context: (props) => new Map([["props", props]]),
    });

    await expect(
      fuzzComponent({
        component: Badge,
        sourcePath: badgePath,
        render,
        numRuns: 8,
        seed: 2,
      }),
    ).resolves.toBeUndefined();
  });

  test("schema-driven fuzzing feeds normalized props into the component", async () => {
    const values: Array<z.infer<typeof receiptSchema>> = [];
    for await (const value of sampleValuesFromSchema({
      schema: receiptSchema,
      numRuns: 4,
      seed: 1,
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
        render: createSvelteRender(),
        numRuns: 16,
        seed: 1,
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
      render: createSvelteRender(),
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
