import { describe, expect, test } from "vitest";
import {
  fuzzComponent,
  quickCheckComponent,
  sampleProps,
} from "../src/index.js";
import { collectAsync } from "./helpers/collect_async.js";
import { createSvelteRender } from "../src/svelte.js";
import { createVueDomRender } from "../src/vue.js";
import SvelteBomb from "./fixtures/SvelteBomb.svelte";
import VueBomb from "./fixtures/VueBomb.vue";

const InlineVueBomb = {
  props: ["label", "mode"],
  setup(props: { label: string; mode?: "safe" | "explode" }) {
    if (props.mode === "explode") {
      throw new Error("explode");
    }
    return () => props.label;
  },
};

describe("cross-framework fuzzing", () => {
  test("fuzzes a Vue SFC directly without a companion props file", async () => {
    await expect(
      fuzzComponent({
        component: VueBomb,
        sourcePath: new URL("./fixtures/VueBomb.vue", import.meta.url),
        numRuns: 16,
        render: async (props) => {
          const candidate = props as Record<string, unknown>;
          if (candidate.mode === "explode") {
            throw new Error("explode");
          }
        },
        seed: 7,
      }),
    ).rejects.toMatchObject({
      name: "ComponentFuzzError",
      failingValue: {
        label: expect.any(String),
      },
    });
  });

  test("fuzzes a Vue component with a companion props type", async () => {
    await expect(
      fuzzComponent({
        component: InlineVueBomb,
        sourcePath: new URL("./fixtures/VueBomb.props.ts", import.meta.url),
        typeName: "VueBombProps",
        numRuns: 16,
        render: createVueDomRender(),
        seed: 7,
      }),
    ).rejects.toMatchObject({
      name: "ComponentFuzzError",
      failingValue: {
        label: expect.any(String),
      },
    });
  });

  test("samples runtime Vue props directly from a SFC", async () => {
    const values = await collectAsync(sampleProps({
      sourcePath: new URL("./fixtures/VueRuntimeBomb.vue", import.meta.url),
      numRuns: 8,
      seed: 9,
    }));

    expect(values).toHaveLength(8);
    for (const value of values) {
      expect(typeof value.label).toBe("string");
      if ("mode" in value) {
        expect(["safe", "explode"]).toContain(value.mode);
      }
    }
  });

  test("quick-checks a Svelte component directly without a companion props file", async () => {
    await expect(
      quickCheckComponent({
        component: SvelteBomb,
        sourcePath: new URL("./fixtures/SvelteBomb.svelte", import.meta.url),
        maxCases: 32,
        render: createSvelteRender(),
      }),
    ).resolves.toMatchObject({
      checkedCases: expect.any(Number),
      totalCases: expect.any(Number),
    });
  });

  test("samples Svelte runes props directly from a component source", async () => {
    const values = await collectAsync(sampleProps({
      sourcePath: new URL("./fixtures/SvelteRunesBomb.svelte", import.meta.url),
      numRuns: 8,
      seed: 5,
    }));

    expect(values).toHaveLength(8);
    for (const value of values) {
      expect(typeof value.label).toBe("string");
      expect(value.label.length).toBeGreaterThanOrEqual(1);
      if ("mode" in value) {
        expect(["safe", "explode"]).toContain(value.mode);
      }
    }
  });

  test("quick-checks a Svelte component with a companion props type", async () => {
    await expect(
      quickCheckComponent({
        component: SvelteBomb,
        sourcePath: new URL("./fixtures/SvelteBomb.props.ts", import.meta.url),
        typeName: "SvelteBombProps",
        maxCases: 32,
        render: createSvelteRender(),
      }),
    ).resolves.toMatchObject({
      checkedCases: expect.any(Number),
      totalCases: expect.any(Number),
    });
  });
});
