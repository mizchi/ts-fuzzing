# Architecture Notes

## React-first design

The primary path is `sourcePath + exportName` backed by the TypeScript compiler API. That route gives the library full access to prop shapes, including callback props, `ReactNode`, and provider props.

## Schema strategy

- `zod` and `valibot` support direct value generation
- generic `Standard Schema` support is treated as a validator overlay
- normalized schema outputs are used for both sampling and rendering

## Framework support

- React is the main documented path
- Vue and Svelte use the same core fuzzing engine with explicit renderers
- direct source extraction supports common `.vue` and `.svelte` prop declaration patterns

## DOM environment

The DOM runner uses `happy-dom` rather than `jsdom`. It installs the minimum global bindings needed by React and Vue renderers while keeping the API local to `createIsolatedDom()`.

## Guided mode

Coverage-guided fuzzing is intentionally lightweight. It uses `node:inspector` precise coverage to rank interesting inputs and grow a corpus, rather than full compiler-level instrumentation.
