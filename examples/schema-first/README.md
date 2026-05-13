# Schema-first Example

This example focuses on **schema-driven workflows** for `ts-fuzzing` and on a few of the higher-level helpers — algebraic invariants, XSS corpus fuzzing, coercion modes, and roundtrip checks. It complements `examples/simple` (which exhaustively covers the value-pipeline API) and the framework adapters under `examples/react-first`, `examples/vue-first`, and `examples/svelte-first`.

Executable docs: [schema-first.example.test.ts](./test/schema-first.example.test.ts)

The test covers:

- generating values from a `zod` schema with `sampleValuesFromSchema()`
- asserting `merge` is a commutative monoid with `fuzzCommutativeMonoid()`
- asserting string concatenation is a monoid with `fuzzMonoid()`
- asserting JSON encode/decode roundtrips with `fuzzRoundtrip()`
- finding XSS escape gaps with the corpus from `ts-fuzzing/security`
- surfacing a boolean-coercion bug with `coercion: "falsy-aware"`

## Install

```bash
pnpm install
```

Requirements:

- Node.js `24+`
- ESM (`"type": "module"`)

## Run

```bash
pnpm test
pnpm typecheck
```

The example is also covered by the main test suite at the repository root.
