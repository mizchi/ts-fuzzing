# React First Example

This is a small React-first sample project for `ts-fuzzing`. The executable docs live in [react-first.example.test.tsx](/Users/mz/ghq/github.com/mizchi/ts-fuzzing/examples/react-first/test/react-first.example.test.tsx:1), which covers the main use cases:

- iterate generated values with `sampleValues()`
- run standard property-based fuzzing with `fuzzReactComponent()`
- catch mount-time failures with `createReactDomRender()`
- fuzz provider props with `createReactDomRender({ providers })`
- iterate values directly from Zod with `sampleValuesFromSchema()`
- persist a corpus with `fuzzReactComponentGuided()`
- run boundary-focused checks with `quickCheckReactComponent()`

React-specific helpers are imported from `ts-fuzzing/react`.

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
