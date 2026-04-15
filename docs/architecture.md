# Architecture Notes

## Generic core

`ts-fuzzing` is organized around a generic value pipeline:

1. `src/analyzer.ts`
   Extracts a `TypeDescriptor` from exported TypeScript types or exported callables.
2. `src/fuzz_data.ts`
   Resolves descriptors from TypeScript or schema sources and samples random or boundary values.
3. `src/input_fuzz.ts`
   Runs property-based fuzzing, boundary-focused quick-checks, and lightweight coverage-guided fuzzing against arbitrary callbacks.

This makes the core usable without any UI framework.

## UI adapters

- `src/react_fuzz.ts` exposes React-focused helpers such as `fuzzReactComponent()`
- `src/component_fuzz.ts` adapts generic value runners to component render strategies
- `src/dom.ts`, `src/vue.ts`, and `src/svelte.ts` provide framework renderers on top of the generic input runner

The component APIs are adapters over the generic value fuzzing layer, not the other way around.

## Type and schema sources

- exported TypeScript types are addressed through `typeName`
- callable exports can still be inferred through `exportName`
- marker types exported from `ts-fuzzing` such as `UUID`, `Int`, and `Pattern<...>` are treated as fuzzing-only hints and merged into the base descriptor when written as intersections like `string & UUID`
- unresolved generic parameters use their `extends` constraint when it can be generalized into a descriptor
- unresolved conditional types are generalized only when their checked type has a usable `extends` constraint and the branches do not depend on `infer`; `infer`-heavy conditionals still fall back to `unknown`
- nongeneralizable generics fall back to `unknown` and surface runtime warnings
- common external runtime types such as `ReactNode`, `URL`, `Map`, and `Set` are normalized before generic object expansion
- `zod` and `valibot` can describe values directly
- generic `Standard Schema` integration is used as a validation and normalization overlay when no direct descriptor is available

## DOM environment

The DOM runner uses `happy-dom`. It installs the minimum globals required by the React and Vue adapters while keeping the environment isolated inside the renderer factory.

## Guided mode

Coverage-guided fuzzing is intentionally lightweight. It uses `node:inspector` precise coverage and a small persisted corpus instead of compiler instrumentation. This keeps setup friction low while still surfacing interesting inputs.
