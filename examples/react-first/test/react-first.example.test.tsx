import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import * as z from "zod";
import {
  createReactDomRender,
  fuzzReactComponent,
  fuzzReactComponentGuided,
  quickCheckReactComponent,
} from "ts-fuzzing/react";
import {
  sampleValues,
  sampleValuesFromSchema,
} from "ts-fuzzing";
import { BoundaryBadge } from "../src/BoundaryBadge.js";
import { Button, type ButtonProps } from "../src/Button.js";
import { EffectfulNotice } from "../src/EffectfulNotice.js";
import { SignupCard } from "../src/SignupCard.js";
import { ThemePanel, ThemeProvider } from "../src/ThemePanel.js";

const tempDirs: string[] = [];

const signupSchema = z.object({
  email: z.string().email(),
  handle: z.string().min(1).max(8).transform((value) => value.toUpperCase()),
  plan: z.enum(["free", "pro"]),
});

const makeTempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-fuzzing-example-"));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { force: true, recursive: true });
  }
});

describe("react-first example project", () => {
  test("react first: sampleValues and fuzzReactComponent", async () => {
    const values: ButtonProps[] = [];
    for await (const value of sampleValues<ButtonProps>({
      sourcePath: new URL("../src/Button.tsx", import.meta.url),
      typeName: "ButtonProps",
      numRuns: 4,
      seed: 7,
    })) {
      values.push(value);
    }

    expect(values).toHaveLength(4);
    expect(values.every((value) => typeof value.label === "string")).toBe(true);
    expect(values.every((value) => value.variant === "primary" || value.variant === "ghost")).toBe(true);

    await expect(
      fuzzReactComponent({
        component: Button,
        sourcePath: new URL("../src/Button.tsx", import.meta.url),
        exportName: "Button",
        numRuns: 24,
        seed: 7,
      }),
    ).resolves.toBeUndefined();
  });

  test("dom runner: useEffect crash も拾える", async () => {
    await expect(
      fuzzReactComponent({
        component: EffectfulNotice,
        sourcePath: new URL("../src/EffectfulNotice.tsx", import.meta.url),
        exportName: "EffectfulNotice",
        render: createReactDomRender(),
        numRuns: 32,
        seed: 5,
      }),
    ).rejects.toMatchObject({
      name: "ReactComponentFuzzError",
      failingValue: {
        mode: "danger",
      },
    });
  });

  test("provider props も一緒に quick-check できる", async () => {
    await expect(
      quickCheckReactComponent({
        component: ThemePanel,
        sourcePath: new URL("../src/ThemePanel.tsx", import.meta.url),
        exportName: "ThemePanel",
        maxCases: 32,
        render: createReactDomRender({
          providers: [
            {
              key: "themeProvider",
              component: ThemeProvider,
              sourcePath: new URL("../src/ThemePanel.tsx", import.meta.url),
              exportName: "ThemeProvider",
              fixedProps: { locale: "ja-JP" },
            },
          ],
        }),
      }),
    ).rejects.toMatchObject({
      name: "ReactComponentFuzzError",
      failingValue: {
        providers: {
          themeProvider: {
            theme: "dark",
          },
        },
      },
    });
  });

  test("schema から直接 props を作って normalized output を使える", async () => {
    const values: Array<z.infer<typeof signupSchema>> = [];
    for await (const value of sampleValuesFromSchema({
      schema: signupSchema,
      numRuns: 6,
      seed: 2,
    })) {
      values.push(value);
    }

    expect(values).toHaveLength(6);
    for (const value of values) {
      expect(value.handle).toBe(value.handle.toUpperCase());
      expect(value.email).toContain("@");
    }

    await expect(
      fuzzReactComponent({
        component: SignupCard,
        schema: signupSchema,
        numRuns: 24,
        seed: 3,
      }),
    ).resolves.toBeUndefined();
  });

  test("guided mode は corpus を保存しながら回せる", async () => {
    const corpusDir = makeTempDir();
    const corpusPath = path.join(corpusDir, "button-corpus.json");

    const report = await fuzzReactComponentGuided({
      component: Button,
      sourcePath: new URL("../src/Button.tsx", import.meta.url),
      exportName: "Button",
      corpusPath,
      initialCorpusSize: 4,
      maxIterations: 8,
      seed: 11,
    });

    expect(report.iterations).toBe(8);
    expect(fs.existsSync(corpusPath)).toBe(true);
    expect(report.corpusSize).toBeGreaterThan(0);
  });

  test("quick-check は boundary case の失敗をそのまま返す", async () => {
    await expect(
      quickCheckReactComponent({
        component: BoundaryBadge,
        sourcePath: new URL("../src/BoundaryBadge.tsx", import.meta.url),
        exportName: "BoundaryBadge",
        maxCases: 64,
      }),
    ).rejects.toMatchObject({
      name: "ReactComponentFuzzError",
      failingValue: {
        count: 2,
        variant: "danger",
      },
    });
  });
});
