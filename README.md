# ts-fuzzing

Generate values from TypeScript types or schemas, then run quick-checks or fuzzing against arbitrary callbacks and UI components.

## Install

Requirements:

- Node.js `24+`
- ESM (`"type": "module"`)

```bash
pnpm add -D ts-fuzzing vitest

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
The examples below assume you are writing `vitest` test cases.

```ts
import { expect, test } from "vitest";
import { fuzzValues } from "ts-fuzzing";

type SearchQuery = {
  page?: number;
  term: string;
};

test("fuzzes a callback with values generated from a TypeScript type", async () => {
  await expect(
    fuzzValues<SearchQuery>({
      sourcePath: new URL("./search.ts", import.meta.url),
      typeName: "SearchQuery",
      numRuns: 200,
      seed: 42,
      run(value) {
        executeSearch(value);
      },
    }),
  ).resolves.toBeUndefined();
});
```

Failures throw `ValueFuzzError`.

```ts
import { expect, test } from "vitest";
import { ValueFuzzError, fuzzValues } from "ts-fuzzing";

test("inspects the minimized failing value", async () => {
  expect.assertions(4);

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
    expect(error).toBeInstanceOf(ValueFuzzError);
    if (error instanceof ValueFuzzError) {
      expect(error.failingValue).toBeDefined();
      expect(error.seed).toBe(42);
      expect(error.warnings).toBeInstanceOf(Array);
    }
  }
});
```

## Common Usage

### Sample generated values

`sampleValues*` returns an async iterator. Consume it with `for await...of` when you want a snapshot in a test. Reuse the same `seed` to replay the same yielded sequence.

```ts
import { expect, test } from "vitest";
import { sampleValues } from "ts-fuzzing";

type SearchQuery = {
  page?: number;
  term: string;
};

test("samples generated values for snapshot-like inspection", async () => {
  const values: SearchQuery[] = [];
  for await (const value of sampleValues<SearchQuery>({
    sourcePath: new URL("./search.ts", import.meta.url),
    typeName: "SearchQuery",
    numRuns: 8,
    seed: 1,
  })) {
    values.push(value);
  }

  expect(values).toHaveLength(8);
  expect(values[0]).toHaveProperty("term");
});
```

### Boundary-focused checks

```ts
import { expect, test } from "vitest";
import { quickCheckValues } from "ts-fuzzing";

test("checks boundary-focused cases", async () => {
  const report = await quickCheckValues<SearchQuery>({
    sourcePath: new URL("./search.ts", import.meta.url),
    typeName: "SearchQuery",
    maxCases: 64,
    run(value) {
      executeSearch(value);
    },
  });

  expect(report.checkedCases).toBeGreaterThan(0);
  expect(report.totalCases).toBeGreaterThan(0);
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
import { expect, test } from "vitest";
import * as z from "zod";
import { fuzzValues, sampleValuesFromSchema } from "ts-fuzzing";

const querySchema = z.object({
  term: z.string().min(1).max(32),
  page: z.number().int().min(1).max(10),
});

test("generates normalized values directly from schema", async () => {
  const values: Array<z.infer<typeof querySchema>> = [];
  for await (const value of sampleValuesFromSchema({
    schema: querySchema,
    numRuns: 16,
    seed: 1,
  })) {
    values.push(value);
  }

  expect(values).toHaveLength(16);
});

test("fuzzes a callback from schema output", async () => {
  await expect(
    fuzzValues({
      schema: querySchema,
      numRuns: 100,
      seed: 1,
      run(value) {
        executeSearch(value);
      },
    }),
  ).resolves.toBeUndefined();
});
```

### React components

Use the React adapter when the consumer is a component rather than a plain callback.

```tsx
import { expect, test } from "vitest";
import { fuzzReactComponent } from "ts-fuzzing/react";
import { Button } from "./Button.js";

test("fuzzes a React component from its exported props type", async () => {
  await expect(
    fuzzReactComponent({
      component: Button,
      sourcePath: new URL("./Button.tsx", import.meta.url),
      exportName: "Button",
      numRuns: 200,
      seed: 42,
    }),
  ).resolves.toBeUndefined();
});
```

By default React uses `renderToStaticMarkup`. Use `createReactDomRender()` if you need mount-time failures such as `useEffect` crashes.

```tsx
import { expect, test } from "vitest";
import { createReactDomRender, fuzzReactComponent } from "ts-fuzzing/react";

test("catches mount-time React failures with the DOM renderer", async () => {
  await expect(
    fuzzReactComponent({
      component: EffectBomb,
      sourcePath: new URL("./EffectBomb.tsx", import.meta.url),
      exportName: "EffectBomb",
      render: createReactDomRender(),
      numRuns: 100,
      seed: 1,
    }),
  ).rejects.toThrow();
});
```

### Provider fuzzing

```tsx
import { expect, test } from "vitest";
import { createReactDomRender, quickCheckReactComponent } from "ts-fuzzing/react";

test("quick-checks provider and component inputs together", async () => {
  const report = await quickCheckReactComponent({
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

  expect(report.checkedCases).toBeGreaterThan(0);
});
```

### Vue and Svelte

Use `fuzzComponent()` with a framework-specific renderer.

```ts
import { expect, test } from "vitest";
import Widget from "./Widget.vue";
import { fuzzComponent } from "ts-fuzzing";
import { createVueDomRender } from "ts-fuzzing/vue";

test("fuzzes a Vue component through the generic component API", async () => {
  await expect(
    fuzzComponent({
      component: Widget,
      sourcePath: new URL("./Widget.vue", import.meta.url),
      render: createVueDomRender(),
      numRuns: 100,
      seed: 1,
    }),
  ).resolves.toBeUndefined();
});
```

```ts
import { expect, test } from "vitest";
import Widget from "./Widget.svelte";
import { quickCheckComponent } from "ts-fuzzing";
import { createSvelteRender } from "ts-fuzzing/svelte";

test("quick-checks a Svelte component through the generic component API", async () => {
  const report = await quickCheckComponent({
    component: Widget,
    sourcePath: new URL("./Widget.svelte", import.meta.url),
    render: createSvelteRender(),
    maxCases: 32,
  });

  expect(report.checkedCases).toBeGreaterThan(0);
});
```

### Invariant helpers

`fuzzRoundtrip` and `fuzzIdempotent` skip the ceremony for the two most common property shapes.

```ts
import { expect, test } from "vitest";
import * as z from "zod";
import { fuzzIdempotent, fuzzRoundtrip } from "ts-fuzzing";

const record = z.object({ name: z.string().min(1).max(16) });

test("JSON encode/decode roundtrips", async () => {
  await expect(
    fuzzRoundtrip({
      schema: record,
      numRuns: 100,
      encode(value) { return JSON.stringify(value); },
      decode(text) { return JSON.parse(text); },
    }),
  ).resolves.toBeUndefined();
});

test("trim is idempotent", async () => {
  await expect(
    fuzzIdempotent({
      schema: z.object({ text: z.string().max(8) }),
      apply(value) { return { text: value.text.trim() }; },
    }),
  ).resolves.toBeUndefined();
});
```

### Differential testing

`fuzzDifferential` runs two implementations against the same generated input and reports the first divergence.

```ts
import { fuzzDifferential } from "ts-fuzzing";

await fuzzDifferential({
  schema: inputSchema,
  implementations: [legacyImpl, rewriteImpl],
  names: ["legacy", "rewrite"],
  numRuns: 200,
});
```

### Stateful / command sequence fuzzing

`fuzzStateful` generates a random sequence of actions, runs each against a reference model and the real implementation, and checks an invariant after every step.

```ts
import fc from "fast-check";
import { fuzzStateful } from "ts-fuzzing";

await fuzzStateful<{ items: number[] }, RealStack>({
  setup: () => ({ model: { items: [] }, real: new RealStack() }),
  actions: [
    {
      name: "push",
      generate: fc.integer(),
      apply({ model, real, input }) {
        model.items.push(input);
        real.push(input);
      },
    },
    {
      name: "pop",
      precondition: (model) => model.items.length > 0,
      apply({ model, real }) {
        model.items.pop();
        real.pop();
      },
    },
  ],
  invariant({ model, real }) {
    if (model.items.length !== real.size()) {
      throw new Error("length diverged");
    }
  },
  maxActions: 40,
  numRuns: 100,
});
```

Failures surface as `StatefulFuzzError` with a `failingTrace` describing the applied actions.

### Regression corpus

`appendToCorpus()` stores a failing value from `ValueFuzzError.failingValue`, and `fuzzFromCorpus()` re-runs every stored entry on the next test. Map and Set values are preserved across save/load.

```ts
import {
  ValueFuzzError,
  appendToCorpus,
  fuzzFromCorpus,
  fuzzValues,
} from "ts-fuzzing";

const corpusPath = new URL("./search-regression.json", import.meta.url);

try {
  await fuzzValues({ schema, run: executeSearch });
} catch (error) {
  if (error instanceof ValueFuzzError) {
    appendToCorpus({ corpusPath, value: error.failingValue });
  }
  throw error;
}

// later, in the regression suite:
const report = await fuzzFromCorpus({
  corpusPath,
  collectAllFailures: true,
  run: executeSearch,
});
expect(report.failures).toEqual([]);
```

### Minimal repro export

When a run fails, `renderReproTest` / `writeReproTest` turn the caught `ValueFuzzError` into a standalone test file so you can commit the failing input as a regression.

```ts
import { ValueFuzzError, fuzzValues, writeReproTest } from "ts-fuzzing";

try {
  await fuzzValues({ schema, run: executeSearch });
} catch (error) {
  if (error instanceof ValueFuzzError) {
    writeReproTest({
      error,
      outputPath: new URL("./search.repro.test.ts", import.meta.url),
      runnerImport: "./search.js",
      runnerSymbol: "executeSearch",
    });
  }
  throw error;
}
```

### Time budget

All value- and component-based fuzzers accept `timeoutMs` (wall-clock interrupt, not marked as a failure) and `perRunTimeoutMs` (per-iteration hard timeout) on top of `numRuns`.

```ts
await fuzzValues({
  schema,
  numRuns: 10_000,
  timeoutMs: 30_000,      // stop after 30 seconds even if runs remain
  perRunTimeoutMs: 500,   // kill a single iteration that hangs past 500 ms
  run: executeSearch,
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

- Runnable non-UI example: [examples/simple/README.md](./examples/simple/README.md)
- Runnable React adapter example: [examples/react-first/README.md](./examples/react-first/README.md)
- Runnable Vue adapter example: [examples/vue-first/README.md](./examples/vue-first/README.md)
- Runnable Svelte adapter example: [examples/svelte-first/README.md](./examples/svelte-first/README.md)
- Design notes and implementation details: [docs/architecture.md](./docs/architecture.md)

<!-- release automation bootstrapped -->
