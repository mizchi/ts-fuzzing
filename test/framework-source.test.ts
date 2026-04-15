import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { prepareFrameworkSource } from "../src/framework_source.js";

const tempDirs: string[] = [];

const writeTempFile = (name: string, content: string) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-fuzzing-framework-"));
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

describe("framework source preparation", () => {
  test("returns undefined for non-framework files", () => {
    const filePath = writeTempFile("plain.ts", "export const x = 1;");
    expect(prepareFrameworkSource(filePath)).toBeUndefined();
  });

  test("prepares svelte sources from export let and runes props", () => {
    const exportedPath = writeTempFile(
      "Widget.svelte",
      `<script context="module">export const meta = "x";</script>
<script lang="ts">
  /** @fuzz.minLength 1 */
  export let label = "ok";
  export let count: number;
</script>
<div>{label}:{count}</div>`,
    );
    const exported = prepareFrameworkSource(exportedPath);
    expect(exported?.typeName).toBe("__TsFuzzingExtracted");
    expect(exported?.virtualSourceText).toContain("declare function $props<T>(): T;");
    expect(exported?.virtualSourceText).toContain("label?: typeof label;");
    expect(exported?.virtualSourceText).toContain("count: typeof count;");
    expect(exported?.virtualSourceText).toContain('export const meta = "x";');

    const runesPath = writeTempFile(
      "Runes.svelte",
      `<script lang="ts">
  let { title, count }: { title: string; count?: number } = $props();
</script>`,
    );
    const runes = prepareFrameworkSource(runesPath);
    expect(runes?.virtualSourceText).toContain("export type __TsFuzzingExtracted = { title: string; count?: number }");

    const genericRunesPath = writeTempFile(
      "RunesGeneric.svelte",
      `<script lang="ts">
  const props = $props<{ label: string; count?: number }>();
</script>`,
    );
    const genericRunes = prepareFrameworkSource(genericRunesPath);
    expect(genericRunes?.virtualSourceText).toContain("export type __TsFuzzingExtracted = { label: string; count?: number }");
  });

  test("returns undefined for svelte files without instance props", () => {
    const filePath = writeTempFile(
      "Empty.svelte",
      `<script context="module">export const meta = "x";</script><div />`,
    );
    expect(prepareFrameworkSource(filePath)).toBeUndefined();
  });

  test("prepares vue sources from script setup and runtime props", () => {
    const typedPath = writeTempFile(
      "Typed.vue",
      `<script setup lang="ts">
type Props = { label: string; count?: number }
defineProps<Props>()
</script>`,
    );
    const typed = prepareFrameworkSource(typedPath);
    expect(typed?.virtualSourceText).toContain("export type __TsFuzzingExtracted = Props;");
    expect(typed?.virtualSourceText).toContain("declare function defineProps<T>(): T;");

    const typedWithDefaultsPath = writeTempFile(
      "TypedDefaults.vue",
      `<script setup lang="ts">
type Props = { label: string; count?: number }
const props = withDefaults(defineProps<Props>(), { count: 1 })
</script>`,
    );
    const typedWithDefaults = prepareFrameworkSource(typedWithDefaultsPath);
    expect(typedWithDefaults?.virtualSourceText).toContain("export type __TsFuzzingExtracted = Props;");

    const runtimePath = writeTempFile(
      "Runtime.vue",
      `<script setup lang="ts">
withDefaults(defineProps({
  label: { type: String, required: true },
  count: Number,
}), { count: 1 })
</script>`,
    );
    const runtime = prepareFrameworkSource(runtimePath);
    expect(runtime?.virtualSourceText).toContain("ExtractPublicPropTypes");
    expect(runtime?.virtualSourceText).toContain("const __tsFuzzingOptions = ({");

    const classicPath = writeTempFile(
      "Classic.vue",
      `<script lang="ts">
import { defineComponent } from "vue";
export default defineComponent({
  props: {
    label: { type: String, required: true },
  },
});
</script>`,
    );
    const classic = prepareFrameworkSource(classicPath);
    expect(classic?.virtualSourceText).toContain("export type __TsFuzzingExtracted = ExtractPublicPropTypes<typeof __tsFuzzingOptions>;");

    const objectLiteralPath = writeTempFile(
      "ObjectLiteral.vue",
      `<script lang="ts">
export default {
  "props": {
    label: { type: String, required: true },
  },
};
</script>`,
    );
    const objectLiteral = prepareFrameworkSource(objectLiteralPath);
    expect(objectLiteral?.virtualSourceText).toContain("const __tsFuzzingOptions = ({");
  });

  test("returns undefined for vue files without props", () => {
    const filePath = writeTempFile(
      "NoProps.vue",
      `<template><div /></template><script setup lang="ts">const x = 1;</script>`,
    );
    expect(prepareFrameworkSource(filePath)).toBeUndefined();
  });
});
