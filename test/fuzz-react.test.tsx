import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  createDomRender,
  fuzzReactComponent,
  fuzzReactComponentGuided,
  quickCheckReactComponent,
  sampleBoundaryProps,
  sampleProps,
} from "../src/index.js";
import { BoundaryWidget } from "./fixtures/BoundaryWidget.js";
import { ContactCard } from "./fixtures/ContactCard.js";
import { ExplosiveCard } from "./fixtures/ExplosiveCard.js";
import { EffectBomb } from "./fixtures/EffectBomb.js";
import { ThemeBomb, ThemeLabel, ThemeProvider } from "./fixtures/ThemeLabel.js";
import { SafeButton } from "./fixtures/SafeButton.js";

describe("props-fuzzing", () => {
  test("samples props from a component props type", async () => {
    const values = await sampleProps({
      sourcePath: new URL("./fixtures/SafeButton.tsx", import.meta.url),
      exportName: "SafeButton",
      numRuns: 5,
      seed: 7,
    });

    expect(values).toHaveLength(5);
    for (const value of values) {
      expect(typeof value.label).toBe("string");
      expect(value.label.length).toBeGreaterThanOrEqual(1);
      expect(value.label.length).toBeLessThanOrEqual(16);
      expect(["primary", "ghost"]).toContain(value.variant);
      if ("count" in value) {
        expect(typeof value.count).toBe("number");
        expect(value.count).toBeGreaterThanOrEqual(0);
        expect(value.count).toBeLessThanOrEqual(5);
      }
      if ("onClick" in value) {
        expect(typeof value.onClick).toBe("function");
      }
    }
  });

  test("generates domain-aware values for email and url patterns", async () => {
    const values = await sampleProps({
      sourcePath: new URL("./fixtures/ContactCard.tsx", import.meta.url),
      exportName: "ContactCard",
      numRuns: 8,
      seed: 12,
    });

    expect(values).toHaveLength(8);
    for (const value of values) {
      expect(typeof value.email).toBe("string");
      expect(value.email).toContain("@");
      expect(typeof value.homepage).toBe("string");
      expect(() => new URL(value.homepage)).not.toThrow();
    }
  });

  test("samples boundary props from constraints", async () => {
    const values = await sampleBoundaryProps({
      sourcePath: new URL("./fixtures/BoundaryWidget.tsx", import.meta.url),
      exportName: "BoundaryWidget",
      maxCases: 32,
    });

    expect(values.some((value) => value.count === 0)).toBe(true);
    expect(values.some((value) => value.count === 2)).toBe(true);
    expect(values.some((value) => value.label.length === 1)).toBe(true);
    expect(values.some((value) => value.label.length === 4)).toBe(true);
    expect(values.some((value) => value.variant === "danger")).toBe(true);
  });

  test("does not throw for a safe component", async () => {
    await expect(
      fuzzReactComponent({
        component: SafeButton,
        sourcePath: new URL("./fixtures/SafeButton.tsx", import.meta.url),
        exportName: "SafeButton",
        numRuns: 50,
        seed: 42,
      }),
    ).resolves.toBeUndefined();
  });

  test("reports the minimized props for a crashing component", async () => {
    await expect(
      fuzzReactComponent({
        component: ExplosiveCard,
        sourcePath: new URL("./fixtures/ExplosiveCard.tsx", import.meta.url),
        exportName: "ExplosiveCard",
        numRuns: 100,
        seed: 3,
      }),
    ).rejects.toMatchObject({
      name: "ReactComponentFuzzError",
      failingProps: {
        variant: "danger",
      },
    });
  });

  test("guided mode finds crashing props and returns coverage summary", async () => {
    await expect(
      fuzzReactComponentGuided({
        component: ExplosiveCard,
        sourcePath: new URL("./fixtures/ExplosiveCard.tsx", import.meta.url),
        exportName: "ExplosiveCard",
        initialCorpusSize: 4,
        maxIterations: 20,
        seed: 11,
      }),
    ).rejects.toMatchObject({
      name: "ReactComponentFuzzError",
      failingProps: {
        variant: "danger",
      },
      report: {
        discoveredBlocks: expect.any(Number),
      },
    });
  });

  test("guided mode persists discovered corpus", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "props-fuzzing-"));
    const corpusPath = path.join(tempDir, "corpus.json");

    await expect(
      fuzzReactComponentGuided({
        component: SafeButton,
        sourcePath: new URL("./fixtures/SafeButton.tsx", import.meta.url),
        exportName: "SafeButton",
        initialCorpusSize: 4,
        maxIterations: 8,
        seed: 13,
        corpusPath,
      }),
    ).resolves.toMatchObject({
      corpusSize: expect.any(Number),
      discoveredBlocks: expect.any(Number),
    });

    expect(fs.existsSync(corpusPath)).toBe(true);
    const savedCorpus = JSON.parse(fs.readFileSync(corpusPath, "utf8"));
    expect(Array.isArray(savedCorpus)).toBe(true);
    expect(savedCorpus.length).toBeGreaterThan(0);
    expect(savedCorpus[0]).toHaveProperty("variant");
  });

  test("guided mode records provider-driven discoveries", async () => {
    await expect(
      fuzzReactComponentGuided({
        component: ThemeBomb,
        sourcePath: new URL("./fixtures/ThemeLabel.tsx", import.meta.url),
        exportName: "ThemeBomb",
        initialCorpusSize: 4,
        maxIterations: 20,
        seed: 8,
        render: createDomRender({
          providers: [
            {
              key: "themeProvider",
              component: ThemeProvider,
              sourcePath: new URL("./fixtures/ThemeLabel.tsx", import.meta.url),
              exportName: "ThemeProvider",
            },
          ],
        }),
      }),
    ).rejects.toMatchObject({
      name: "ReactComponentFuzzError",
      failingProps: {
        providers: {
          themeProvider: {
            theme: "dark",
          },
        },
      },
      report: {
        discoveries: expect.arrayContaining([
          expect.objectContaining({
            input: expect.objectContaining({
              providers: {
                themeProvider: {
                  theme: "dark",
                },
              },
            }),
          }),
        ]),
      },
    });
  });

  test("DOM runner catches crashes triggered from effects", async () => {
    await expect(
      fuzzReactComponent({
        component: EffectBomb,
        sourcePath: new URL("./fixtures/EffectBomb.tsx", import.meta.url),
        exportName: "EffectBomb",
        numRuns: 30,
        seed: 9,
        render: createDomRender(),
      }),
    ).rejects.toMatchObject({
      name: "ReactComponentFuzzError",
      failingProps: {
        mode: "explode",
      },
    });
  });

  test("DOM runner supports wrapper providers", async () => {
    await expect(
      fuzzReactComponent({
        component: ThemeLabel,
        sourcePath: new URL("./fixtures/ThemeLabel.tsx", import.meta.url),
        exportName: "ThemeLabel",
        numRuns: 20,
        seed: 5,
        render: createDomRender({
          wrapper: ({ children }) => <ThemeProvider theme="dark">{children}</ThemeProvider>,
        }),
      }),
    ).resolves.toBeUndefined();
  });

  test("DOM runner fuzzes provider props together with component props", async () => {
    await expect(
      fuzzReactComponent({
        component: ThemeBomb,
        sourcePath: new URL("./fixtures/ThemeLabel.tsx", import.meta.url),
        exportName: "ThemeBomb",
        numRuns: 30,
        seed: 8,
        render: createDomRender({
          providers: [
            {
              key: "themeProvider",
              component: ThemeProvider,
              sourcePath: new URL("./fixtures/ThemeLabel.tsx", import.meta.url),
              exportName: "ThemeProvider",
            },
          ],
        }),
      }),
    ).rejects.toMatchObject({
      name: "ReactComponentFuzzError",
      failingProps: {
        providers: {
          themeProvider: {
            theme: "dark",
          },
        },
      },
    });
  });

  test("quick-check finds boundary failures across component props", async () => {
    await expect(
      quickCheckReactComponent({
        component: BoundaryWidget,
        sourcePath: new URL("./fixtures/BoundaryWidget.tsx", import.meta.url),
        exportName: "BoundaryWidget",
        maxCases: 64,
      }),
    ).rejects.toMatchObject({
      name: "ReactComponentFuzzError",
      failingProps: {
        count: 2,
        variant: "danger",
      },
      report: {
        checkedCases: expect.any(Number),
        totalCases: expect.any(Number),
      },
    });
  });

  test("quick-check finds provider boundary failures", async () => {
    await expect(
      quickCheckReactComponent({
        component: ThemeBomb,
        sourcePath: new URL("./fixtures/ThemeLabel.tsx", import.meta.url),
        exportName: "ThemeBomb",
        maxCases: 32,
        render: createDomRender({
          providers: [
            {
              key: "themeProvider",
              component: ThemeProvider,
              sourcePath: new URL("./fixtures/ThemeLabel.tsx", import.meta.url),
              exportName: "ThemeProvider",
            },
          ],
        }),
      }),
    ).rejects.toMatchObject({
      name: "ReactComponentFuzzError",
      failingProps: {
        providers: {
          themeProvider: {
            theme: "dark",
          },
        },
      },
      report: {
        checkedCases: expect.any(Number),
        totalCases: expect.any(Number),
      },
    });
  });
});
