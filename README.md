# ts-fuzzing

Generate values from TypeScript types or schemas, then run quick-checks or fuzzing against arbitrary callbacks and UI components.

## Install

Requirements:

- Node.js `24+`
- ESM (`"type": "module"`)

```bash
pnpm add -D ts-fuzzing

# Optional schema support
pnpm add -D zod valibot

# Optional React adapter
pnpm add react react-dom

# Optional framework adapters
pnpm add vue
pnpm add svelte
```

## Quick Start

Use exported TypeScript types as the source of truth, then run a generic consumer callback with generated values.

```ts
import { fuzzValues } from "ts-fuzzing";

type SearchQuery = {
  page?: number;
  term: string;
};

await fuzzValues<SearchQuery>({
  sourcePath: new URL("./search.ts", import.meta.url),
  typeName: "SearchQuery",
  numRuns: 200,
  seed: 42,
  run(value) {
    executeSearch(value);
  },
});
```

Failures throw `ValueFuzzError`.

```ts
import { ValueFuzzError, fuzzValues } from "ts-fuzzing";

try {
  await fuzzValues<SearchQuery>({
    sourcePath: new URL("./search.ts", import.meta.url),
    typeName: "SearchQuery",
    seed: 42,
    run(value) {
      executeSearch(value);
    },
  });
} catch (error) {
  if (error instanceof ValueFuzzError) {
    console.error(error.failingValue);
    console.error(error.seed);
    console.error(error.warnings);
  }
}
```

## Common Usage

### Sample generated values

```ts
import { sampleValues } from "ts-fuzzing";

type SearchQuery = {
  page?: number;
  term: string;
};

const values = await sampleValues<SearchQuery>({
  sourcePath: new URL("./search.ts", import.meta.url),
  typeName: "SearchQuery",
  numRuns: 8,
  seed: 1,
});
```

### Boundary-focused checks

```ts
import { quickCheckValues } from "ts-fuzzing";

await quickCheckValues<SearchQuery>({
  sourcePath: new URL("./search.ts", import.meta.url),
  typeName: "SearchQuery",
  maxCases: 64,
  run(value) {
    executeSearch(value);
  },
});
```

### Type-level fuzzing hints

Keep the original base type visible and add fuzzing-specific hints through intersections.

```ts
import type {
  ISODateString,
  Int,
  Max,
  MaxLength,
  Min,
  MinLength,
  Pattern,
  UUID,
} from "ts-fuzzing";

export type SearchQuery = {
  id: string & UUID;
  createdAt: string & ISODateString;
  page: number & Int & Min<1> & Max<10>;
  term: string & MinLength<1> & MaxLength<32>;
  contact: string & Pattern<"email">;
};
```

These hints affect fuzzing only. They do not validate runtime values by themselves.

### Schema-driven values

```ts
import * as z from "zod";
import { fuzzValues, sampleValuesFromSchema } from "ts-fuzzing";

const querySchema = z.object({
  term: z.string().min(1).max(32),
  page: z.number().int().min(1).max(10),
});

const values = await sampleValuesFromSchema({
  schema: querySchema,
  numRuns: 16,
  seed: 1,
});

await fuzzValues({
  schema: querySchema,
  numRuns: 100,
  seed: 1,
  run(value) {
    executeSearch(value);
  },
});
```

### React components

Use the React adapter when the consumer is a component rather than a plain callback.

```tsx
import { fuzzReactComponent } from "ts-fuzzing/react";
import { Button } from "./Button.js";

await fuzzReactComponent({
  component: Button,
  sourcePath: new URL("./Button.tsx", import.meta.url),
  exportName: "Button",
  numRuns: 200,
  seed: 42,
});
```

By default React uses `renderToStaticMarkup`. Use `createReactDomRender()` if you need mount-time failures such as `useEffect` crashes.

```tsx
import { createReactDomRender, fuzzReactComponent } from "ts-fuzzing/react";

await fuzzReactComponent({
  component: EffectBomb,
  sourcePath: new URL("./EffectBomb.tsx", import.meta.url),
  exportName: "EffectBomb",
  render: createReactDomRender(),
  numRuns: 100,
  seed: 1,
});
```

### Provider fuzzing

```tsx
import { createReactDomRender, quickCheckReactComponent } from "ts-fuzzing/react";

await quickCheckReactComponent({
  component: ThemePanel,
  sourcePath: new URL("./ThemePanel.tsx", import.meta.url),
  exportName: "ThemePanel",
  render: createReactDomRender({
    providers: [
      {
        key: "themeProvider",
        component: ThemeProvider,
        sourcePath: new URL("./ThemeProvider.tsx", import.meta.url),
        exportName: "ThemeProvider",
        fixedProps: { locale: "en-US" },
      },
    ],
  }),
});
```

### Vue and Svelte

Use `fuzzComponent()` with a framework-specific renderer.

```ts
import Widget from "./Widget.vue";
import { fuzzComponent } from "ts-fuzzing";
import { createVueDomRender } from "ts-fuzzing/vue";

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
import { quickCheckComponent } from "ts-fuzzing";
import { createSvelteRender } from "ts-fuzzing/svelte";

await quickCheckComponent({
  component: Widget,
  sourcePath: new URL("./Widget.svelte", import.meta.url),
  render: createSvelteRender(),
  maxCases: 32,
});
```

## Notes

- `sampleProps*` remains available as a component-focused alias. React adapter exports live under `ts-fuzzing/react`, and Vue/Svelte render helpers live under `ts-fuzzing/vue` and `ts-fuzzing/svelte`.
- source-based APIs cannot infer compile-time TypeScript types from `sourcePath` alone. Use explicit generics such as `sampleValues<SearchQuery>(...)` or `fuzzValues<SearchQuery>(...)` when you want editor typing.
- `zod` and `valibot` can describe values directly. Generic `Standard Schema` support is treated as a validator overlay unless the vendor adapter exposes a descriptor.
- unresolved generic parameters use their `extends` constraint when one can be generalized. If a generic cannot be generalized, `ts-fuzzing` emits a runtime warning and falls back to `unknown` value generation.
- conditional types are supported when TypeScript already resolves them to concrete types or unions, and for simple unresolved conditionals that can be generalized from an `extends` constraint. Conditional types that rely on `infer` still fall back to `unknown` with a warning.
- marker types such as `UUID`, `ULID`, `ISODateString`, `Int`, `Float`, `Min`, `Max`, `MinLength`, `MaxLength`, `MinItems`, `MaxItems`, and `Pattern<...>` are intended to be intersected with an explicit base type such as `string & UUID` or `number & Int`.
- common external runtime types such as `ReactNode`, `URL`, `Map`, and `Set` are normalized into dedicated fuzzing descriptors.

## Examples and Docs

- Runnable non-UI example: [examples/simple/README.md](/Users/mz/ghq/github.com/mizchi/ts-fuzzing/examples/simple/README.md:1)
- Runnable React adapter example: [examples/react-first/README.md](/Users/mz/ghq/github.com/mizchi/ts-fuzzing/examples/react-first/README.md:1)
- Design notes and implementation details: [docs/architecture.md](/Users/mz/ghq/github.com/mizchi/ts-fuzzing/docs/architecture.md:1)
