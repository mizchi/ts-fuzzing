# props-fuzzing

Generate valid-looking prop values from TypeScript types or schemas and check whether component rendering throws.

## Install

Requirements:

- Node.js `24+`
- ESM (`"type": "module"`)

```bash
pnpm add -D props-fuzzing

# React
pnpm add react react-dom

# Optional schema support
pnpm add -D zod valibot

# Optional framework support
pnpm add vue
pnpm add svelte
```

## Quick Start

```tsx
import { fuzzReactComponent } from "props-fuzzing";
import { Button } from "./Button.js";

await fuzzReactComponent({
  component: Button,
  sourcePath: new URL("./Button.tsx", import.meta.url),
  exportName: "Button",
  numRuns: 200,
  seed: 42,
});
```

Failures throw `ReactComponentFuzzError`.

```ts
try {
  await fuzzReactComponent({
    component: Button,
    sourcePath: new URL("./Button.tsx", import.meta.url),
    exportName: "Button",
    seed: 42,
  });
} catch (error) {
  if (error instanceof ReactComponentFuzzError) {
    console.error(error.failingProps);
    console.error(error.seed);
  }
}
```

## Common Usage

### React DOM rendering

Use `createDomRender()` when you want to catch mount-time failures such as `useEffect` crashes.

```tsx
import { createDomRender, fuzzReactComponent } from "props-fuzzing";

await fuzzReactComponent({
  component: EffectBomb,
  sourcePath: new URL("./EffectBomb.tsx", import.meta.url),
  exportName: "EffectBomb",
  render: createDomRender(),
  numRuns: 100,
  seed: 1,
});
```

### Provider fuzzing

```tsx
const render = createDomRender({
  providers: [
    {
      key: "themeProvider",
      component: ThemeProvider,
      sourcePath: new URL("./ThemeProvider.tsx", import.meta.url),
      exportName: "ThemeProvider",
      fixedProps: { locale: "en-US" },
    },
  ],
});
```

### Boundary checks

```tsx
import { quickCheckReactComponent } from "props-fuzzing";

await quickCheckReactComponent({
  component: Button,
  sourcePath: new URL("./Button.tsx", import.meta.url),
  exportName: "Button",
  maxCases: 64,
});
```

### Schema-driven values

```tsx
import * as z from "zod";
import { fuzzReactComponent, samplePropsFromSchema } from "props-fuzzing";

const cardSchema = z.object({
  title: z.string().min(1).max(16),
  variant: z.enum(["safe", "danger"]),
});

const values = await samplePropsFromSchema({
  schema: cardSchema,
  numRuns: 16,
  seed: 1,
});

await fuzzReactComponent({
  component: Card,
  schema: cardSchema,
  numRuns: 100,
  seed: 1,
});
```

### Vue and Svelte

Use `fuzzComponent()` with a framework-specific renderer.

```ts
import Widget from "./Widget.vue";
import { createVueDomRender, fuzzComponent } from "props-fuzzing";

await fuzzComponent({
  component: Widget,
  sourcePath: new URL("./Widget.vue", import.meta.url),
  render: createVueDomRender(),
  numRuns: 100,
  seed: 1,
});
```

```ts
import Widget from "./Widget.svelte";
import { createSvelteRender, quickCheckComponent } from "props-fuzzing";

await quickCheckComponent({
  component: Widget,
  sourcePath: new URL("./Widget.svelte", import.meta.url),
  render: createSvelteRender(),
  maxCases: 32,
});
```

## Examples and Docs

- Runnable example project: [examples/react-first/README.md](/Users/mz/ghq/github.com/mizchi/props-fuzzing/examples/react-first/README.md:1)
- Design notes and implementation details: [docs/architecture.md](/Users/mz/ghq/github.com/mizchi/props-fuzzing/docs/architecture.md:1)
