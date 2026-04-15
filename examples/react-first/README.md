# React First Example

This is a small React-first sample project for `props-fuzzing`. The executable docs live in [react-first.example.test.tsx](/Users/mz/ghq/github.com/mizchi/props-fuzzing/examples/react-first/test/react-first.example.test.tsx:1), which covers the main use cases:

- inspect generated values with `sampleProps()`
- run standard property-based fuzzing with `fuzzReactComponent()`
- catch mount-time failures with `createDomRender()`
- fuzz provider props with `createDomRender({ providers })`
- generate values directly from Zod with `samplePropsFromSchema()`
- persist a corpus with `fuzzReactComponentGuided()`
- run boundary-focused checks with `quickCheckReactComponent()`

This folder is designed to be runnable inside the repository. It includes its own `package.json`, `tsconfig.json`, and `vitest.config.ts`, while resolving `props-fuzzing` to the local source tree through aliases.

## Install

```bash
pnpm install
```

Requirements:

- Node.js `24+`
- ESM (`"type": "module"`)
- `pnpm typecheck` in this example targets `src/`
- if you copy this example into another repository, replace the local alias setup with the published `props-fuzzing` package

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
