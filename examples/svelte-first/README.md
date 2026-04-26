# Svelte First Example

This is a small Svelte-first sample project for `ts-fuzzing`. The executable docs live in [svelte-first.example.test.ts](./test/svelte-first.example.test.ts), which covers the main use cases:

- iterate props parsed from classic `export let` declarations with `sampleProps()`
- iterate props parsed from Svelte 5 runes (`$props()`) with `sampleProps()`
- run component fuzzing through `createSvelteRender()`
- catch script-time throws as `ComponentFuzzError`
- pair a `.svelte` component with a companion `.props.ts` file through `typeName`
- provide a shared Svelte context through `createSvelteRender({ context })`
- fuzz props from a Zod schema with `fuzzComponent({ schema })`
- sample boundary-focused props with `sampleBoundaryProps()`
- persist a corpus while running with `fuzzComponentGuided({ corpusPath })`

Svelte-specific helpers are imported from `ts-fuzzing/svelte`.

This folder is designed to be runnable inside the repository. It includes its own `package.json`, `tsconfig.json`, and `vitest.config.ts`, while resolving `ts-fuzzing` to the local source tree through aliases.

## Install

```bash
pnpm install
```

Requirements:

- Node.js `24+`
- ESM (`"type": "module"`)
- `pnpm typecheck` in this example uses `svelte-check`
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
