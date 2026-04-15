# Simple Example

This is a small non-UI sample project for `ts-fuzzing`. The executable docs live in [simple.example.test.ts](/Users/mz/ghq/github.com/mizchi/ts-fuzzing/examples/simple/test/simple.example.test.ts:1), which covers the main use cases:

- inspect generated values with `sampleValues()`
- run generic callback fuzzing with `fuzzValues()`
- run boundary-focused checks with `quickCheckValues()`
- catch failures as `ValueFuzzError`
- generate normalized values directly from Zod with `sampleValuesFromSchema()`

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
