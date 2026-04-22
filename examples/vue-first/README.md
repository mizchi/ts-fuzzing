# Vue First Example

This is a small Vue-first sample project for `ts-fuzzing`. The executable docs live in [vue-first.example.test.ts](./test/vue-first.example.test.ts), which covers the main use cases:

- iterate generated props straight from a `.vue` SFC with `sampleProps()`
- render the SFC through `vue/server-renderer` with a custom render strategy
- catch setup-time failures as `ComponentFuzzError`
- pair a `.vue` component with a companion `.props.ts` file through `typeName`
- fuzz props from a Zod schema with `fuzzComponent({ schema })`
- run a lightweight check directly on generated props via `render: async (props) => …`

Vue SFCs are compiled in SSR mode under vitest's node environment, so this example uses `vue/server-renderer` directly. When you render client-side in a DOM environment, the `createVueDomRender()` helper from `ts-fuzzing/vue` is also available.

This folder is designed to be runnable inside the repository. It includes its own `package.json`, `tsconfig.json`, and `vitest.config.ts`, while resolving `ts-fuzzing` to the local source tree through aliases.

## Install

```bash
pnpm install
```

Requirements:

- Node.js `24+`
- ESM (`"type": "module"`)
- `pnpm typecheck` in this example targets `src/`
- if you copy this example into another repository, replace the local alias setup with the published `ts-fuzzing` package

## Run

From this folder:

```bash
pnpm test
pnpm typecheck
```

From the repository root, the example is also covered by the main test suite:

```bash
pnpm test
```
